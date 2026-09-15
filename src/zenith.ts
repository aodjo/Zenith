import { Device, type DeviceOptions } from "./device/index.js";
import { Screen } from "./ui/index.js";
import { OpenChat, type JoinResult } from "./openchat/index.js";
import { Sender } from "./send/index.js";
import {
  KakaoDb,
  type Member,
  type Message,
  type OpenProfile,
  type Owner,
  type Room,
} from "./db/index.js";
import { ChatObserver } from "./observer/index.js";
import { EventObserver } from "./events/index.js";
import type { RoomEvent } from "./events/index.js";

/**
 * Options for constructing a {@link Zenith} client.
 */
export interface ZenithOptions {
  /** The adb serial of the device to drive (e.g. `"127.0.0.1:5555"`). */
  serial: string;
  /** Path to the adb executable; defaults to `"adb"` on PATH. */
  adbPath?: string;
  /** The bot account's user id; auto-detected from the database when omitted. */
  botUserId?: number;
  /** The open profile name used by {@link Zenith.join} when none is given per call. */
  defaultProfile?: string;
}

/**
 * Options for joining a room via {@link Zenith.join}.
 */
export interface ZenithJoinOptions {
  /** The open profile to enter with; falls back to the client's `defaultProfile`. */
  profile?: string;
  /** Per-step timeout override, in milliseconds. */
  timeoutMs?: number;
}

/**
 * Options for {@link Zenith.watchMessages}.
 */
export interface WatchMessagesOptions {
  /** Restrict to a single chat room id. */
  chatId?: string;
  /** Emit only plain text messages, skipping feed/system rows. */
  textOnly?: boolean;
  /** Poll interval in milliseconds. */
  intervalMs?: number;
}

/**
 * Options for {@link Zenith.watchEvents}.
 */
export interface WatchEventsOptions {
  /** Snapshot interval in milliseconds. */
  intervalMs?: number;
}

/**
 * The one-stop client for driving a KakaoTalk account on a device.
 *
 * Composes the device transport, database reader, and the join/leave, send, message, and
 * room-event features behind a single ergonomic surface so an application never wires the
 * lower-level modules together by hand. Every UI action is serialized through the device's
 * operation queue, and the underlying {@link Zenith.device}, {@link Zenith.db}, and
 * {@link Zenith.screen} remain accessible for advanced use.
 *
 * @example
 * const zenith = new Zenith({ serial: "127.0.0.1:5555", defaultProfile: "bot" });
 * await zenith.join("https://open.kakao.com/o/xxxx");
 * await zenith.send("https://open.kakao.com/o/xxxx", "안녕하세요");
 * await zenith.watchMessages((m) => console.log(m.text), { textOnly: true });
 */
export class Zenith {
  /** The underlying device transport (advanced use). */
  readonly device: Device;
  /** The database reader (advanced use). */
  readonly db: KakaoDb;
  /** The selector-based screen driver (advanced use). */
  readonly screen: Screen;
  private readonly openChat: OpenChat;
  private readonly sender: Sender;
  private readonly defaultProfile: string | undefined;

  /**
   * Creates a client bound to one device.
   *
   * @param {ZenithOptions} options - The device serial and optional adb path, bot id, and default profile.
   *
   * @example
   * const zenith = new Zenith({ serial: "127.0.0.1:5555" });
   */
  constructor(options: ZenithOptions) {
    const deviceOptions: DeviceOptions = {};
    if (options.adbPath !== undefined) deviceOptions.adbPath = options.adbPath;
    this.device = new Device(options.serial, deviceOptions);
    this.db = new KakaoDb(this.device, options.botUserId !== undefined ? { botUserId: options.botUserId } : {});
    this.screen = new Screen(this.device);
    this.openChat = new OpenChat(this.device);
    this.sender = new Sender(this.device);
    this.defaultProfile = options.defaultProfile;
  }

  /**
   * Lists the open chat rooms the bot has joined.
   *
   * @returns {Promise<Room[]>} The joined rooms.
   *
   * @example
   * const rooms = await zenith.rooms();
   */
  rooms(): Promise<Room[]> {
    return this.db.listJoinedRooms();
  }

  /**
   * Lists a room's members with decrypted nicknames.
   *
   * @param {string | number} chatId - The chat room id.
   * @returns {Promise<Member[]>} The room's members.
   *
   * @example
   * const members = await zenith.members("18474375066224479");
   */
  members(chatId: string | number): Promise<Member[]> {
    return this.db.listMembers(chatId);
  }

  /**
   * Returns a room's participant count.
   *
   * @param {string | number} chatId - The chat room id.
   * @returns {Promise<number>} The number of participants.
   *
   * @example
   * const n = await zenith.memberCount("18474375066224479");
   */
  memberCount(chatId: string | number): Promise<number> {
    return this.db.roomMemberCount(chatId);
  }

  /**
   * Returns a room's owner/host.
   *
   * @param {string | number} chatId - The chat room id.
   * @returns {Promise<Owner | undefined>} The owner, or undefined if unresolved.
   *
   * @example
   * const owner = await zenith.owner("18474375066224479");
   */
  owner(chatId: string | number): Promise<Owner | undefined> {
    return this.db.roomOwner(chatId);
  }

  /**
   * Returns a room's most recent messages, decrypted.
   *
   * @param {string | number} chatId - The chat room id.
   * @param {number} [limit] - Maximum messages to return.
   * @returns {Promise<Message[]>} Recent messages, newest last.
   *
   * @example
   * const recent = await zenith.messages("18474375066224479", 10);
   */
  messages(chatId: string | number, limit?: number): Promise<Message[]> {
    return this.db.recentMessages(chatId, limit);
  }

  /**
   * Lists the bot account's reusable open profiles.
   *
   * @returns {Promise<OpenProfile[]>} The available open profiles.
   *
   * @example
   * const profiles = await zenith.profiles();
   */
  profiles(): Promise<OpenProfile[]> {
    return this.db.listOpenProfiles();
  }

  /**
   * Joins an open chat under a profile.
   *
   * Uses the per-call profile, or the client's `defaultProfile`. Throws if neither is set.
   * Propagates {@link ProfileUnavailableError} when the chosen profile is not offered by
   * the room.
   *
   * @async
   * @param {string} link - The open chat link (full URL or bare code).
   * @param {ZenithJoinOptions} [options={}] - The profile to use and an optional timeout.
   * @returns {Promise<JoinResult>} The joined room's title.
   * @throws {Error} If no profile is given and no `defaultProfile` was configured.
   *
   * @example
   * await zenith.join("https://open.kakao.com/o/xxxx", { profile: "bot" });
   */
  async join(link: string, options: ZenithJoinOptions = {}): Promise<JoinResult> {
    const profile = options.profile ?? this.defaultProfile;
    if (profile === undefined) {
      throw new Error("join needs a profile: pass { profile } or set defaultProfile");
    }
    return this.openChat.join(
      options.timeoutMs !== undefined ? { link, profile, timeoutMs: options.timeoutMs } : { link, profile },
    );
  }

  /**
   * Leaves an open chat.
   *
   * @param {string} link - The open chat link of the room to leave.
   * @param {number} [timeoutMs] - Per-step timeout override, in milliseconds.
   * @returns {Promise<void>} Resolves once the leave is confirmed.
   *
   * @example
   * await zenith.leave("https://open.kakao.com/o/xxxx");
   */
  leave(link: string, timeoutMs?: number): Promise<void> {
    return timeoutMs !== undefined ? this.openChat.leave(link, timeoutMs) : this.openChat.leave(link);
  }

  /**
   * Sends a text message to an open chat.
   *
   * @param {string} link - The open chat link of the room to send to.
   * @param {string} text - The message text (Korean supported).
   * @returns {Promise<void>} Resolves once the message has been sent.
   *
   * @example
   * await zenith.send("https://open.kakao.com/o/xxxx", "안녕하세요");
   */
  send(link: string, text: string): Promise<void> {
    return this.sender.send(link, text);
  }

  /**
   * Starts delivering new messages to a handler and returns the running observer.
   *
   * Seeds to the newest message so only messages arriving after this call are delivered.
   * Stop with the returned observer's `stop()`.
   *
   * @param {(message: Message) => void} handler - Called with each new message.
   * @param {WatchMessagesOptions} [options={}] - Chat filter, text-only filter, and interval.
   * @returns {Promise<ChatObserver>} The started observer.
   *
   * @example
   * const observer = await zenith.watchMessages((m) => reply(m), { textOnly: true });
   * // later: observer.stop();
   */
  async watchMessages(
    handler: (message: Message) => void,
    options: WatchMessagesOptions = {},
  ): Promise<ChatObserver> {
    const observer = new ChatObserver(this.db, options);
    observer.onMessage(handler);
    await observer.start();
    return observer;
  }

  /**
   * Starts delivering room events (title/host/staff/join/leave/kick) to a handler.
   *
   * Takes a baseline snapshot so only changes after this call are reported. Stop with the
   * returned observer's `stop()`.
   *
   * @param {(event: RoomEvent) => void} handler - Called with each detected room event.
   * @param {WatchEventsOptions} [options={}] - Snapshot interval override.
   * @returns {Promise<EventObserver>} The started observer.
   *
   * @example
   * const observer = await zenith.watchEvents((e) => console.log(e.kind));
   * // later: observer.stop();
   */
  async watchEvents(
    handler: (event: RoomEvent) => void,
    options: WatchEventsOptions = {},
  ): Promise<EventObserver> {
    const observer = new EventObserver(
      this.db,
      options.intervalMs !== undefined ? { feeds: this.db, intervalMs: options.intervalMs } : { feeds: this.db },
    );
    observer.onEvent(handler);
    await observer.start();
    return observer;
  }
}
