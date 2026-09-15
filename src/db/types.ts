/**
 * Shared value types returned by the {@link KakaoDb} read layer.
 *
 * Identifiers that can exceed JavaScript's safe integer range (user ids, link ids, chat
 * ids) are typed as strings to preserve their exact value; small counts and timestamps
 * are numbers.
 */

/**
 * One of the bot account's reusable open-chat profiles (an `open_link` of type 1).
 */
export interface OpenProfile {
  /** The open link id backing this profile. */
  linkId: string;
  /** The profile's display name (plaintext in `open_link`). */
  name: string;
  /** The profile's `open.kakao.com` URL. */
  url: string;
  /** The link code extracted from {@link OpenProfile.url}. */
  code: string;
}

/**
 * A joined open chat room.
 */
export interface Room {
  /** The chat room id (`chat_rooms.id`). */
  chatId: string;
  /** The KakaoTalk room type, e.g. `"OM"` or `"OD"`. */
  type: string;
  /** The backing open link id, if resolved. */
  linkId?: string;
  /** The room name (from `open_link`), if resolved. */
  name?: string;
  /** The room's open link URL, if resolved. */
  url?: string;
  /** The link code, from the room's `v.params` or its URL. */
  code?: string;
  /** The owner/host user id (`open_link.user_id`), if resolved. */
  ownerId?: string;
  /** Other members' ids from `active_member_ids` (excludes the bot). */
  memberIds: string[];
  /** Total participants including the bot ({@link Room.memberIds} length + 1). */
  memberCount: number;
  /** The room's participant limit from `open_link.member_limit`, if resolved. */
  memberLimit?: number;
}

/**
 * A member of an open chat room.
 */
export interface Member {
  /** The member's per-open-chat user id. */
  userId: string;
  /** The member's decrypted nickname. */
  nickname: string;
  /** The member's link member type (e.g. host vs normal). */
  memberType: number;
}

/**
 * The owner/host of an open chat room.
 */
export interface Owner {
  /** The owner's user id. */
  userId: string;
  /** The owner's decrypted nickname, if the owner is a listed member. */
  nickname?: string;
}

/**
 * A chat log message with its body decrypted.
 */
export interface Message {
  /** The `chat_logs._id` (monotonically increasing local id). */
  logId: number;
  /** The chat room id the message belongs to. */
  chatId: string;
  /** The sender's user id. */
  userId: string;
  /** The KakaoTalk message type code. */
  type: number;
  /** The decrypted message text (may be empty for non-text messages). */
  text: string;
  /** Creation time as a unix epoch (seconds), as stored by KakaoTalk. */
  createdAt: number;
  /** Whether the bot account sent this message. */
  isMine: boolean;
}

/**
 * The minimal read surface a {@link ChatObserver} needs from a database.
 *
 * Decoupling the observer from {@link KakaoDb} through this interface lets it be tested
 * against a fake source without a device.
 */
export interface MessageSource {
  /**
   * Returns the largest `chat_logs._id` currently present.
   *
   * @returns {Promise<number>} The current maximum log id, or 0 when there are none.
   *
   * @example
   * const from = await source.maxLogId();
   */
  maxLogId(): Promise<number>;

  /**
   * Returns messages with a log id greater than `lastLogId`, oldest first.
   *
   * @param {number} lastLogId - Exclusive lower bound on `chat_logs._id`.
   * @param {number} [limit] - Maximum number of messages to return.
   * @returns {Promise<Message[]>} New messages in ascending log-id order.
   *
   * @example
   * const fresh = await source.messagesSince(1000, 200);
   */
  messagesSince(lastLogId: number, limit?: number): Promise<Message[]>;
}
