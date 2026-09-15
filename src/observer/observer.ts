import type { Message, MessageSource } from "../db/types.js";

/** Default gap between database polls, in milliseconds. */
const DEFAULT_INTERVAL_MS = 1500;

/** Default maximum messages fetched per poll. */
const DEFAULT_BATCH = 200;

/** A callback invoked with each newly observed message. */
export type MessageListener = (message: Message) => void;

/**
 * Configuration for a {@link ChatObserver}.
 */
export interface ObserverOptions {
  /** Poll interval in milliseconds. */
  intervalMs?: number;
  /** Maximum messages fetched per poll. */
  batchSize?: number;
  /** If set, only messages in this chat room are emitted. */
  chatId?: string;
}

/**
 * Watches a {@link MessageSource} for new chat messages by polling.
 *
 * KakaoTalk has no push hook Zenith can subscribe to, so new messages are found by
 * polling `chat_logs` for rows past the last seen id. On {@link ChatObserver.start} the
 * cursor is seeded to the current maximum id so existing history is not replayed; each
 * poll advances the cursor and delivers new messages to listeners in order.
 *
 * @example
 * const observer = new ChatObserver(db);
 * observer.onMessage((m) => console.log(m.text));
 * await observer.start();
 */
export class ChatObserver {
  private readonly source: MessageSource;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly chatId: string | undefined;
  private readonly listeners = new Set<MessageListener>();
  private lastLogId = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;

  /**
   * Creates an observer over a message source.
   *
   * @param {MessageSource} source - The database (or fake) to poll, e.g. a {@link KakaoDb}.
   * @param {ObserverOptions} [options={}] - Poll interval, batch size, and optional chat filter.
   *
   * @example
   * const observer = new ChatObserver(db, { intervalMs: 1000, chatId: "18474375066224479" });
   */
  constructor(source: MessageSource, options: ObserverOptions = {}) {
    this.source = source;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH;
    this.chatId = options.chatId;
  }

  /**
   * Registers a listener for new messages.
   *
   * @param {MessageListener} listener - Called with each new message, in log-id order.
   * @returns {() => void} A function that unsubscribes the listener.
   *
   * @example
   * const off = observer.onMessage((m) => handle(m));
   * off(); // stop receiving
   */
  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Seeds the cursor to the newest message and begins polling.
   *
   * Seeding to the current maximum id means only messages that arrive after start are
   * delivered. Calling start while already running is a no-op.
   *
   * @returns {Promise<void>} Resolves once the cursor is seeded and polling has begun.
   *
   * @example
   * await observer.start();
   */
  async start(): Promise<void> {
    if (this.timer) return;
    this.lastLogId = await this.source.maxLogId();
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
   * Runs one poll cycle: fetches new messages, advances the cursor, and emits them.
   *
   * Re-entrant calls are skipped so a slow query cannot overlap the next interval. Exposed
   * so callers (and tests) can drive a single cycle without the timer.
   *
   * @returns {Promise<Message[]>} The messages emitted this cycle (after the chat filter).
   *
   * @example
   * const delivered = await observer.poll();
   */
  async poll(): Promise<Message[]> {
    if (this.polling) return [];
    this.polling = true;
    try {
      const fresh = await this.source.messagesSince(this.lastLogId, this.batchSize);
      const emitted: Message[] = [];
      for (const message of fresh) {
        if (message.logId > this.lastLogId) this.lastLogId = message.logId;
        if (this.chatId !== undefined && message.chatId !== this.chatId) continue;
        emitted.push(message);
        for (const listener of this.listeners) listener(message);
      }
      return emitted;
    } finally {
      this.polling = false;
    }
  }
}
