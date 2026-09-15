import type { Member, Room } from "../db/index.js";
import { MEMBER_TYPE } from "./parse.js";
import type { EventMember, RoomEvent, RoomSnapshot } from "./types.js";

/**
 * The read surface {@link snapshotRooms} needs from a database.
 *
 * Declared structurally so a {@link KakaoDb} satisfies it directly and tests can supply a
 * fake without a device.
 */
export interface RoomStateSource {
  /**
   * Lists the joined open chat rooms.
   *
   * @returns {Promise<Room[]>} The rooms, each with its link, title, and owner when resolved.
   *
   * @example
   * const rooms = await source.listJoinedRooms();
   */
  listJoinedRooms(): Promise<Room[]>;

  /**
   * Lists a room's members with roles and decrypted nicknames.
   *
   * @param {string | number} chatId - The chat room id.
   * @returns {Promise<Member[]>} The room's members.
   *
   * @example
   * const members = await source.listMembers("123");
   */
  listMembers(chatId: string | number): Promise<Member[]>;
}

/**
 * Builds a {@link RoomSnapshot} for every joined room.
 *
 * Reads rooms and their members and records each member's role code and nickname. The
 * result is the input to {@link diffSnapshots}; comparing two of these detects the
 * administrative changes KakaoTalk writes silently (a title change updates `open_link`
 * with no feed row).
 *
 * @param {RoomStateSource} source - The database to read, e.g. a {@link KakaoDb}.
 * @returns {Promise<Map<string, RoomSnapshot>>} Snapshots keyed by chat id.
 *
 * @example
 * const before = await snapshotRooms(db);
 */
export async function snapshotRooms(source: RoomStateSource): Promise<Map<string, RoomSnapshot>> {
  const rooms = await source.listJoinedRooms();
  const snapshots = new Map<string, RoomSnapshot>();
  for (const room of rooms) {
    const members = await source.listMembers(room.chatId);
    const memberTypes = new Map<string, number>();
    const nicknames = new Map<string, string>();
    for (const member of members) {
      memberTypes.set(member.userId, member.memberType);
      if (member.nickname) nicknames.set(member.userId, member.nickname);
    }
    const snapshot: RoomSnapshot = { chatId: room.chatId, memberTypes, nicknames };
    if (room.linkId) snapshot.linkId = room.linkId;
    if (room.name) snapshot.title = room.name;
    if (room.ownerId) snapshot.ownerId = room.ownerId;
    snapshots.set(room.chatId, snapshot);
  }
  return snapshots;
}

/**
 * Builds an {@link EventMember} from a user id and a nickname lookup.
 *
 * @param {string} userId - The member's user id.
 * @param {Map<string, string>} nicknames - Nicknames keyed by user id.
 * @returns {EventMember} The member with a nickname attached when known.
 *
 * @example
 * toMember("1", new Map([["1", "n"]])); // { userId: "1", nickname: "n" }
 */
function toMember(userId: string, nicknames: Map<string, string>): EventMember {
  const nickname = nicknames.get(userId);
  return nickname !== undefined ? { userId, nickname } : { userId };
}

/**
 * Diffs two room-state snapshots into the events that occurred between them.
 *
 * Emits title, host, co-admin (부방장) add/remove, and member join/leave events for every
 * room present in both snapshots. Rooms only in one snapshot are ignored (the bot itself
 * joining or leaving a room is out of scope here). Co-admin direction is decided by the
 * role code ({@link MEMBER_TYPE.ADMIN}), which the feed alone cannot provide.
 *
 * @param {Map<string, RoomSnapshot>} previous - The earlier snapshot.
 * @param {Map<string, RoomSnapshot>} next - The later snapshot.
 * @returns {RoomEvent[]} The events between the two snapshots.
 *
 * @example
 * const events = diffSnapshots(before, after); // e.g. [{ kind: "titleChanged", ... }]
 */
export function diffSnapshots(
  previous: Map<string, RoomSnapshot>,
  next: Map<string, RoomSnapshot>,
): RoomEvent[] {
  const events: RoomEvent[] = [];
  for (const [chatId, current] of next) {
    const before = previous.get(chatId);
    if (!before) continue;

    if (before.title !== undefined && current.title !== undefined && before.title !== current.title) {
      const event: RoomEvent = {
        kind: "titleChanged",
        chatId,
        previousTitle: before.title,
        title: current.title,
      };
      if (current.linkId) event.linkId = current.linkId;
      events.push(event);
    }

    if (before.ownerId && current.ownerId && before.ownerId !== current.ownerId) {
      const event: RoomEvent = {
        kind: "hostChanged",
        chatId,
        previousOwnerId: before.ownerId,
        ownerId: current.ownerId,
      };
      if (current.linkId) event.linkId = current.linkId;
      events.push(event);
    }

    for (const [userId, type] of current.memberTypes) {
      const previousType = before.memberTypes.get(userId);
      if (previousType === undefined) {
        events.push({ kind: "memberJoined", chatId, member: toMember(userId, current.nicknames) });
        continue;
      }
      const wasAdmin = previousType === MEMBER_TYPE.ADMIN;
      const isAdmin = type === MEMBER_TYPE.ADMIN;
      if (!wasAdmin && isAdmin) {
        events.push({ kind: "staffAdded", chatId, member: toMember(userId, current.nicknames) });
      } else if (wasAdmin && !isAdmin) {
        events.push({ kind: "staffRemoved", chatId, member: toMember(userId, current.nicknames) });
      }
    }

    for (const userId of before.memberTypes.keys()) {
      if (!current.memberTypes.has(userId)) {
        events.push({ kind: "memberLeft", chatId, member: toMember(userId, before.nicknames) });
      }
    }
  }
  return events;
}
