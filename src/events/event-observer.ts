import type { MessageSource } from "../db/index.js";
import { parseFeed } from "./parse.js";
import { diffSnapshots, snapshotRooms, type RoomStateSource } from "./snapshot.js";
import type { RoomEvent, RoomSnapshot } from "./types.js";

/** Default gap between state snapshots, in milliseconds. */
const DEFAULT_INTERVAL_MS = 3000;

/** Default maximum feed rows examined per cycle when refining leaves into kicks. */
const DEFAULT_FEED_BATCH = 500;

/** KakaoTalk chat_logs type code for a feed/system row (text messages are type 1). */
const FEED_ROW_TYPE = 0;

/** A callback invoked with each detected room event. */
export type RoomEventListener = (event: RoomEvent) => void;

/**
 * Configuration for a {@link EventObserver}.
 */
export interface EventObserverOptions {
  /** Snapshot interval in milliseconds. */
  intervalMs?: number;
  /**
   * Optional feed source used only to reclassify a detected leave as a kick.
   * The state diff is authoritative for every other event; feeds add the kick distinction
   * a diff cannot make.
   */
  feeds?: MessageSource;
}

/**
 * Watches open chat rooms for administrative and membership events by diffing state.
 *
 * KakaoTalk records some changes (a title change) silently in `open_link` with no feed
 * row, so this polls a full room-state snapshot and diffs consecutive snapshots to emit
 * title, host, co-admin (부방장), and join/leave events reliably. When a feed source is
 * supplied, a detected leave is upgraded to a kick if a matching kick feed appears in the
 * same cycle. On {@link EventObserver.start} the first snapshot is taken as a baseline so
 * existing state is not reported as change.
 *
 * @example
 * const observer = new EventObserver(db, { feeds: db });
 * observer.onEvent((e) => console.log(e.kind));
 * await observer.start();
 */
export class EventObserver {
  private readonly source: RoomStateSource;
  private readonly feeds: MessageSource | undefined;
  private readonly intervalMs: number;
  private readonly listeners = new Set<RoomEventListener>();
  private lastSnapshot = new Map<string, RoomSnapshot>();
  private feedCursor = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;

  /**
   * Creates an observer over a room-state source.
   *
   * @param {RoomStateSource} source - The database (or fake) to snapshot, e.g. a {@link KakaoDb}.
   * @param {EventObserverOptions} [options={}] - Interval and optional feed source.
   *
   * @example
   * const observer = new EventObserver(db, { intervalMs: 5000 });
   */
  constructor(source: RoomStateSource, options: EventObserverOptions = {}) {
    this.source = source;
    this.feeds = options.feeds;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  /**
   * Registers a listener for room events.
   *
   * @param {RoomEventListener} listener - Called with each detected event.
   * @returns {() => void} A function that unsubscribes the listener.
   *
   * @example
   * const off = observer.onEvent((e) => handle(e));
   * off();
   */
  onEvent(listener: RoomEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Takes the baseline snapshot and begins polling.
   *
   * The baseline means only changes after start are reported. Calling start while already
   * running is a no-op.
   *
   * @returns {Promise<void>} Resolves once the baseline is captured and polling has begun.
   *
   * @example
   * await observer.start();
   */
  async start(): Promise<void> {
    if (this.timer) return;
    this.lastSnapshot = await snapshotRooms(this.source);
    if (this.feeds) this.feedCursor = await this.feeds.maxLogId();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.intervalMs);
  }

  /**
   * Stops polling. Safe to call when not running.
   *
   * @returns {void} Nothing.
   *
   * @example
   * observer.stop();
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Runs one cycle: snapshots state, diffs against the last snapshot, and emits events.
   *
   * When a feed source is configured, leaves are reclassified as kicks where a kick feed
   * appears this cycle. Re-entrant calls are skipped so a slow read cannot overlap the
   * next interval. Exposed so callers and tests can drive a single cycle.
   *
   * @returns {Promise<RoomEvent[]>} The events emitted this cycle.
   *
   * @example
   * const events = await observer.poll();
   */
  async poll(): Promise<RoomEvent[]> {
    if (this.polling) return [];
    this.polling = true;
    try {
      const next = await snapshotRooms(this.source);
      let events = diffSnapshots(this.lastSnapshot, next);
      this.lastSnapshot = next;
      if (this.feeds) events = await this.applyKickRefinement(events);
      for (const event of events) {
        for (const listener of this.listeners) listener(event);
      }
      return events;
    } finally {
      this.polling = false;
    }
  }

  /**
   * Upgrades detected leaves to kicks using new feed rows.
   *
   * Reads feed rows since the last cursor, collects the members named by kick feeds, and
   * rewrites matching `memberLeft` events as `memberKicked`. All other events pass through
   * unchanged.
   *
   * @param {RoomEvent[]} events - The events from the state diff this cycle.
   * @returns {Promise<RoomEvent[]>} The events with leaves reclassified where applicable.
   *
   * @example
   * const refined = await this.applyKickRefinement(diffEvents);
   */
  private async applyKickRefinement(events: RoomEvent[]): Promise<RoomEvent[]> {
    const feeds = this.feeds;
    if (!feeds) return events;
    const messages = await feeds.messagesSince(this.feedCursor, DEFAULT_FEED_BATCH);
    const kicked = new Set<string>();
    for (const message of messages) {
      if (message.logId > this.feedCursor) this.feedCursor = message.logId;
      if (message.type !== FEED_ROW_TYPE) continue;
      let event: RoomEvent;
      try {
        event = parseFeed(message.text, message.chatId);
      } catch {
        continue;
      }
      if (event.kind === "memberKicked") kicked.add(`${event.chatId}:${event.member.userId}`);
    }
    if (kicked.size === 0) return events;
    return events.map((event) =>
      event.kind === "memberLeft" && kicked.has(`${event.chatId}:${event.member.userId}`)
        ? { kind: "memberKicked", chatId: event.chatId, member: event.member }
        : event,
    );
  }
}
