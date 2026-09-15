import type { EventMember, RoomEvent } from "./types.js";

/**
 * KakaoTalk `link_member_type` role codes, as observed on the device.
 *
 * A member's role is read from `open_chat_member.link_member_type`. Only HOST, NORMAL,
 * and ADMIN have been confirmed live; they are what the state diff needs to classify
 * co-admin (부방장) changes.
 */
export const MEMBER_TYPE = {
  /** The room host (방장). */
  HOST: 1,
  /** A normal participant. */
  NORMAL: 2,
  /** A co-admin / 부방장. */
  ADMIN: 4,
} as const;

/**
 * KakaoTalk feed type codes carried in a feed row's decrypted body.
 *
 * JOIN and SET_MEMBER_TYPE were confirmed live on the device; LEAVE, KICKED, and
 * HAND_OVER_HOST are the commonly-observed values but were not generated during
 * discovery, so treat them as best-effort. Unrecognized codes surface as an
 * `unknownFeed` event rather than being dropped.
 */
export const FEED_TYPE = {
  /** A member left the room. (best-effort, not live-verified) */
  LEAVE: 2,
  /** A member joined via the open link. (verified) */
  JOIN: 4,
  /** A member was kicked. (best-effort, not live-verified) */
  KICKED: 6,
  /** A member was granted co-admin (부방장). (verified) */
  STAFF_ON: 11,
  /** A member's co-admin (부방장) role was revoked. (verified) */
  STAFF_OFF: 12,
  /** The host was handed over. (best-effort, not live-verified) */
  HAND_OVER_HOST: 14,
} as const;

/**
 * A feed body decoded into its type code and referenced members.
 */
export interface DecodedFeed {
  /** The KakaoTalk feedType code. */
  feedType: number;
  /** Members named in the feed, with ids preserved exactly as strings. */
  members: EventMember[];
}

/**
 * Decodes a feed row's JSON body into its feedType and members.
 *
 * The body is small JSON such as `{"feedType":4,"members":[{"userId":123,"nickName":"n"}]}`
 * or `{"feedType":11,"member":{"userId":123,"nickName":"n"}}`. User ids are extracted with
 * a regex rather than `JSON.parse`, because open-chat member ids exceed JavaScript's safe
 * integer range and would lose precision if parsed as numbers.
 *
 * @param {string} body - The decrypted feed body (JSON text).
 * @returns {DecodedFeed} The feedType and the members it references.
 * @throws {Error} If no `feedType` is present in the body.
 *
 * @example
 * decodeFeed('{"feedType":4,"members":[{"userId":7701035270796385044,"nickName":"Ryan"}]}');
 * // { feedType: 4, members: [{ userId: "7701035270796385044", nickname: "Ryan" }] }
 */
export function decodeFeed(body: string): DecodedFeed {
  const typeMatch = /"feedType"\s*:\s*(\d+)/.exec(body);
  if (!typeMatch) {
    throw new Error("feed body has no feedType");
  }
  const feedType = Number(typeMatch[1]);
  const members: EventMember[] = [];
  const memberRe = /"userId"\s*:\s*(\d+)(?:\s*,\s*"nickName"\s*:\s*"((?:[^"\\]|\\.)*)")?/g;
  let m: RegExpExecArray | null;
  while ((m = memberRe.exec(body)) !== null) {
    const member: EventMember = { userId: m[1]! };
    if (m[2] !== undefined) member.nickname = decodeJsonString(m[2]);
    members.push(member);
  }
  return { feedType, members };
}

/**
 * Decodes the escape sequences inside a captured JSON string body.
 *
 * @param {string} raw - The string contents between the quotes (escapes still encoded).
 * @returns {string} The unescaped string.
 *
 * @example
 * decodeJsonString('a\\nb'); // "a\nb"
 */
function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/**
 * Maps a decrypted feed row body to a {@link RoomEvent}.
 *
 * Classifies join/leave/kick/host-handover and co-admin grant/revoke from the feedType.
 * The state diff in `./snapshot` independently and authoritatively derives staff, host,
 * and title changes from role codes; this feed classification is a complement that also
 * distinguishes a kick from a leave. Unrecognized types become `unknownFeed`.
 *
 * @param {string} body - The decrypted feed body (JSON text from a `type=0` chat log).
 * @param {string} chatId - The chat room id the feed belongs to.
 * @returns {RoomEvent} The classified event.
 * @throws {Error} If the body has no feedType.
 *
 * @example
 * parseFeed('{"feedType":4,"members":[{"userId":1,"nickName":"n"}]}', "123");
 * // { kind: "memberJoined", chatId: "123", member: { userId: "1", nickname: "n" } }
 */
export function parseFeed(body: string, chatId: string): RoomEvent {
  const { feedType, members } = decodeFeed(body);
  const first = members[0] ?? { userId: "" };
  switch (feedType) {
    case FEED_TYPE.JOIN:
      return { kind: "memberJoined", chatId, member: first };
    case FEED_TYPE.LEAVE:
      return { kind: "memberLeft", chatId, member: first };
    case FEED_TYPE.KICKED:
      return { kind: "memberKicked", chatId, member: first };
    case FEED_TYPE.STAFF_ON:
      return { kind: "staffAdded", chatId, member: first };
    case FEED_TYPE.STAFF_OFF:
      return { kind: "staffRemoved", chatId, member: first };
    case FEED_TYPE.HAND_OVER_HOST:
      return {
        kind: "hostChanged",
        chatId,
        previousOwnerId: "",
        ownerId: first.userId,
      };
    default:
      return { kind: "unknownFeed", chatId, feedType, members };
  }
}
