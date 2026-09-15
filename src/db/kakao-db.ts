import type { Device } from "../device/device.js";
import { decrypt } from "../crypto/index.js";
import {
  COL_SEP,
  ROW_SEP,
  codeFromUrl,
  encFromV,
  isMineFromV,
  linkParamCode,
  parseIdArray,
  splitRows,
} from "./parse.js";
import type { Member, Message, MessageSource, OpenProfile, Owner, Room } from "./types.js";

/** Absolute path to the primary KakaoTalk database (chat logs and rooms). */
const DB_MAIN = "/data/data/com.kakao.talk/databases/KakaoTalk.db";

/** Absolute path to the secondary KakaoTalk database (open links, members, friends). */
const DB_AUX = "/data/data/com.kakao.talk/databases/KakaoTalk2.db";

/** Open link type for the account's reusable open profiles (as opposed to group rooms). */
const OPEN_PROFILE_TYPE = 1;

/** Default number of recent messages returned by {@link KakaoDb.recentMessages}. */
const DEFAULT_MESSAGE_LIMIT = 30;

/** Default page size for {@link KakaoDb.messagesSince}. */
const DEFAULT_SINCE_LIMIT = 200;

/**
 * Constructor options for {@link KakaoDb}.
 */
export interface KakaoDbOptions {
  /** Fallback bot user id used when it cannot be detected from the database. */
  botUserId?: number;
}

/**
 * Reads and decrypts KakaoTalk's on-device SQLite databases over adb.
 *
 * KakaoTalk's databases are plain SQLite files whose sensitive cells are individually
 * AES-encrypted; this class runs read-only queries through the device's `sqlite3` and
 * decrypts fields using the salt rule (names key on the bot's user id, message bodies
 * key on the sender's user id). It is the read half of Zenith, complementing the UI
 * automation in `openchat`.
 *
 * @example
 * const db = new KakaoDb(device);
 * const rooms = await db.listJoinedRooms();
 */
export class KakaoDb {
  private readonly device: Device;
  private readonly fallbackBotId: number | undefined;
  private cachedBotId: number | undefined;

  /**
   * Binds the reader to a device and optional fallback bot id.
   *
   * @param {Device} device - The device whose KakaoTalk databases to read.
   * @param {KakaoDbOptions} [options={}] - Optional fallback bot user id.
   *
   * @example
   * const db = new KakaoDb(device, { botUserId: 435096401 });
   */
  constructor(device: Device, options: KakaoDbOptions = {}) {
    this.device = device;
    this.fallbackBotId = options.botUserId;
  }

  /**
   * Runs a read-only SQL query against a database and returns raw string cells.
   *
   * Uses root `sqlite3` with control-character separators so field values cannot be
   * confused with row or column boundaries.
   *
   * @param {string} db - Absolute path to the database file on the device.
   * @param {string} sql - The SQL to execute.
   * @returns {Promise<string[][]>} Rows of string cells.
   * @throws {Error} If adb or sqlite3 fails.
   *
   * @example
   * const rows = await this.rows(DB_AUX, "SELECT id FROM open_link;");
   */
  private async rows(db: string, sql: string): Promise<string[][]> {
    const out = await this.device.execOut(
      "su",
      "0",
      "sqlite3",
      "-separator",
      COL_SEP,
      "-newline",
      ROW_SEP,
      db,
      sql,
    );
    return splitRows(out.toString("utf8"));
  }

  /**
   * Validates that an id is a plain integer before interpolating it into SQL.
   *
   * Room and log ids come from our own database and are numeric; this guards against any
   * non-numeric value reaching a query string.
   *
   * @param {string | number} id - The id to validate.
   * @returns {string} The id as a string, guaranteed to match `-?\d+`.
   * @throws {RangeError} If `id` is not a plain integer.
   *
   * @example
   * this.assertId("18474375066224479"); // "18474375066224479"
   */
  private assertId(id: string | number): string {
    const s = String(id);
    if (!/^-?\d+$/.test(s)) {
      throw new RangeError(`Unsafe id: ${s}`);
    }
    return s;
  }

  /**
   * Detects (and caches) the logged-in bot account's user id.
   *
   * Reads the most recent message the account marked as its own; falls back to the id
   * supplied at construction when no such message exists yet.
   *
   * @returns {Promise<number>} The bot account user id.
   * @throws {Error} If the id can be neither detected nor supplied.
   *
   * @example
   * const me = await db.botUserId(); // 435096401
   */
  async botUserId(): Promise<number> {
    if (this.cachedBotId !== undefined) return this.cachedBotId;
    const rows = await this.rows(
      DB_MAIN,
      `SELECT user_id FROM chat_logs WHERE v LIKE '%"isMine":true%' ORDER BY _id DESC LIMIT 1;`,
    );
    const detected = rows[0]?.[0] ? Number(rows[0][0]) : this.fallbackBotId;
    if (!detected) {
      throw new Error("Could not determine bot userId; pass options.botUserId");
    }
    this.cachedBotId = detected;
    return detected;
  }

  /**
   * Lists the account's reusable open profiles.
   *
   * These are the identities the bot can present when joining a room that permits open
   * profiles; each is an `open_link` of the profile type.
   *
   * @returns {Promise<OpenProfile[]>} The account's open profiles.
   *
   * @example
   * const profiles = await db.listOpenProfiles();
   */
  async listOpenProfiles(): Promise<OpenProfile[]> {
    const rows = await this.rows(
      DB_AUX,
      `SELECT id,name,url FROM open_link WHERE type=${OPEN_PROFILE_TYPE};`,
    );
    return rows.map(([linkId = "", name = "", url = ""]) => ({
      linkId,
      name,
      url,
      code: codeFromUrl(url) ?? "",
    }));
  }

  /**
   * Lists the open chat rooms the account has joined.
   *
   * Reads open chat rows from `chat_rooms` and resolves each to its open link (name, URL,
   * owner) via the member table or the room's link code. Member count is the number of
   * other members plus the bot. KakaoTalk's internal placeholder rooms (negative chat ids
   * with no backing link) are excluded.
   *
   * @returns {Promise<Room[]>} The joined open chat rooms.
   *
   * @example
   * const rooms = await db.listJoinedRooms();
   */
  async listJoinedRooms(): Promise<Room[]> {
    const roomRows = await this.rows(
      DB_MAIN,
      `SELECT id,type,active_member_ids,v FROM chat_rooms WHERE type IN ('OM','OD');`,
    );
    const linkByChat = new Map<string, string>();
    for (const [chatId = "", linkId = ""] of await this.rows(
      DB_AUX,
      `SELECT DISTINCT involved_chat_id,link_id FROM open_chat_member;`,
    )) {
      if (chatId && linkId) linkByChat.set(chatId, linkId);
    }
    const links = new Map<string, { name: string; url: string; ownerId: string }>();
    for (const [id = "", name = "", url = "", ownerId = ""] of await this.rows(
      DB_AUX,
      `SELECT id,name,url,user_id FROM open_link;`,
    )) {
      links.set(id, { name, url, ownerId });
    }
    const linkByCode = new Map<string, string>();
    for (const [id, info] of links) {
      const code = codeFromUrl(info.url);
      if (code) linkByCode.set(code, id);
    }

    return roomRows.filter((row) => !(row[0] ?? "").startsWith("-")).map(([chatId = "", type = "", activeIds = "", v = ""]) => {
      const code = linkParamCode(v);
      const linkId = linkByChat.get(chatId) ?? (code ? linkByCode.get(code) : undefined);
      const link = linkId ? links.get(linkId) : undefined;
      const memberIds = parseIdArray(activeIds);
      const room: Room = {
        chatId,
        type,
        memberIds,
        memberCount: memberIds.length + 1,
      };
      if (linkId) room.linkId = linkId;
      if (link?.name) room.name = link.name;
      if (link?.url) room.url = link.url;
      const resolvedCode = code ?? (link ? codeFromUrl(link.url) : undefined);
      if (resolvedCode) room.code = resolvedCode;
      if (link?.ownerId) room.ownerId = link.ownerId;
      return room;
    });
  }

  /**
   * Lists the other members of an open chat room with decrypted nicknames.
   *
   * Nicknames are decrypted with the bot's user id per the salt rule. The bot itself is
   * not included (KakaoTalk does not store a self row in the member table).
   *
   * @param {string | number} chatId - The chat room id.
   * @returns {Promise<Member[]>} The room's other members.
   *
   * @example
   * const members = await db.listMembers("18474375066224479");
   */
  async listMembers(chatId: string | number): Promise<Member[]> {
    const id = this.assertId(chatId);
    const botId = await this.botUserId();
    const rows = await this.rows(
      DB_AUX,
      `SELECT user_id,nickname,enc,link_member_type FROM open_chat_member WHERE involved_chat_id=${id};`,
    );
    return rows.map(([userId = "", nickname = "", enc = "", memberType = "0"]) => ({
      userId,
      nickname: decrypt(Number(enc), nickname, botId),
      memberType: Number(memberType),
    }));
  }

  /**
   * Returns the total participant count of a room (other members plus the bot).
   *
   * @param {string | number} chatId - The chat room id.
   * @returns {Promise<number>} The participant count, at least 1.
   *
   * @example
   * const count = await db.roomMemberCount("18474375066224479"); // 3
   */
  async roomMemberCount(chatId: string | number): Promise<number> {
    const id = this.assertId(chatId);
    const rows = await this.rows(
      DB_MAIN,
      `SELECT active_member_ids FROM chat_rooms WHERE id=${id};`,
    );
    return parseIdArray(rows[0]?.[0] ?? "[]").length + 1;
  }

  /**
   * Resolves the owner/host of an open chat room.
   *
   * Finds the room's open link and returns its owner id, decrypting the owner's nickname
   * when the owner appears in the member table.
   *
   * @param {string | number} chatId - The chat room id.
   * @returns {Promise<Owner | undefined>} The owner, or undefined if it cannot be resolved.
   *
   * @example
   * const owner = await db.roomOwner("18494183798013340");
   */
  async roomOwner(chatId: string | number): Promise<Owner | undefined> {
    const id = this.assertId(chatId);
    const linkRows = await this.rows(
      DB_AUX,
      `SELECT link_id FROM open_chat_member WHERE involved_chat_id=${id} LIMIT 1;`,
    );
    const linkId = linkRows[0]?.[0];
    if (!linkId) return undefined;
    const ownerRows = await this.rows(
      DB_AUX,
      `SELECT user_id FROM open_link WHERE id=${this.assertId(linkId)};`,
    );
    const ownerId = ownerRows[0]?.[0];
    if (!ownerId) return undefined;
    const members = await this.listMembers(id);
    const owner = members.find((m) => m.userId === ownerId);
    return owner ? { userId: ownerId, nickname: owner.nickname } : { userId: ownerId };
  }

  /**
   * Returns the most recent messages of a room, oldest first, with text decrypted.
   *
   * Each message body is decrypted with its sender's user id and the encoding type stored
   * in the row's `v` blob.
   *
   * @param {string | number} chatId - The chat room id.
   * @param {number} [limit=30] - Maximum number of messages to return.
   * @returns {Promise<Message[]>} Recent messages in ascending log-id order.
   *
   * @example
   * const msgs = await db.recentMessages("18474375066224479", 10);
   */
  async recentMessages(
    chatId: string | number,
    limit: number = DEFAULT_MESSAGE_LIMIT,
  ): Promise<Message[]> {
    const id = this.assertId(chatId);
    const rows = await this.rows(
      DB_MAIN,
      `SELECT _id,user_id,type,message,created_at,v FROM chat_logs WHERE chat_id=${id} ORDER BY _id DESC LIMIT ${Number(limit)};`,
    );
    return rows.map((row) => this.toMessage(row, id)).reverse();
  }

  /**
   * Returns the largest `chat_logs._id` currently stored (a {@link MessageSource} method).
   *
   * @returns {Promise<number>} The maximum log id, or 0 when there are no messages.
   *
   * @example
   * const cursor = await db.maxLogId();
   */
  async maxLogId(): Promise<number> {
    const rows = await this.rows(DB_MAIN, `SELECT MAX(_id) FROM chat_logs;`);
    return Number(rows[0]?.[0] ?? 0) || 0;
  }

  /**
   * Returns messages newer than a log id, oldest first (a {@link MessageSource} method).
   *
   * @param {number} lastLogId - Exclusive lower bound on `chat_logs._id`.
   * @param {number} [limit=200] - Maximum number of messages to return.
   * @returns {Promise<Message[]>} New messages in ascending log-id order.
   *
   * @example
   * const fresh = await db.messagesSince(cursor);
   */
  async messagesSince(lastLogId: number, limit: number = DEFAULT_SINCE_LIMIT): Promise<Message[]> {
    const since = this.assertId(lastLogId);
    const rows = await this.rows(
      DB_MAIN,
      `SELECT _id,user_id,type,message,created_at,v,chat_id FROM chat_logs WHERE _id>${since} ORDER BY _id ASC LIMIT ${Number(limit)};`,
    );
    return rows.map((row) => this.toMessage(row, row[6] ?? ""));
  }

  /**
   * Maps a raw `chat_logs` row to a decrypted {@link Message}.
   *
   * @param {string[]} row - The raw cells: `[_id,user_id,type,message,created_at,v,...]`.
   * @param {string} chatId - The chat id to attach (row's own or the queried room).
   * @returns {Message} The decrypted message.
   *
   * @example
   * const message = this.toMessage(["10","435096401","1","Base64==","1700000000",'{"enc":31}'], "123");
   */
  private toMessage(row: string[], chatId: string): Message {
    const [logId = "0", userId = "", type = "0", message = "", createdAt = "0", v = ""] = row;
    return {
      logId: Number(logId),
      chatId,
      userId,
      type: Number(type),
      text: decrypt(encFromV(v), message, Number(userId)),
      createdAt: Number(createdAt),
      isMine: isMineFromV(v),
    };
  }
}

/** Re-exported so consumers can type against the observer's data source. */
export type { MessageSource };
