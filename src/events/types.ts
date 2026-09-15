/**
 * Typed open-chat room events emitted by the events module.
 *
 * Two sources feed these: KakaoTalk's `chat_logs` feed rows (parsed by `./parse`) and
 * diffs of room state read from the databases (`./snapshot`). Some administrative
 * changes — notably a room title change — are written silently to `open_link` with no
 * feed row, so the state diff is the authoritative source for those, while feeds add
 * detail a diff cannot (e.g. distinguishing a kick from a voluntary leave).
 */

/** A member referenced by a feed or diff: an exact string user id and optional nickname. */
export interface EventMember {
  /** The member's user id, kept as a string because open-chat ids exceed 2^53. */
  userId: string;
  /** The member's nickname, when known. */
  nickname?: string;
}

/** A room's open chat title changed. */
export interface TitleChangedEvent {
  kind: "titleChanged";
  /** The chat room id. */
  chatId: string;
  /** The backing open link id, if known. */
  linkId?: string;
  /** The title before the change. */
  previousTitle: string;
  /** The title after the change. */
  title: string;
}

/** A room's host (방장) was handed over to a different user. */
export interface HostChangedEvent {
  kind: "hostChanged";
  /** The chat room id. */
  chatId: string;
  /** The backing open link id, if known. */
  linkId?: string;
  /** The previous host's user id. */
  previousOwnerId: string;
  /** The new host's user id. */
  ownerId: string;
}

/** A member was granted co-admin (부방장). */
export interface StaffAddedEvent {
  kind: "staffAdded";
  /** The chat room id. */
  chatId: string;
  /** The promoted member. */
  member: EventMember;
}

/** A member's co-admin (부방장) role was revoked. */
export interface StaffRemovedEvent {
  kind: "staffRemoved";
  /** The chat room id. */
  chatId: string;
  /** The demoted member. */
  member: EventMember;
}

/** A member joined the room. */
export interface MemberJoinedEvent {
  kind: "memberJoined";
  /** The chat room id. */
  chatId: string;
  /** The member who joined. */
  member: EventMember;
}

/** A member left the room (voluntarily, or a leave that could not be classified as a kick). */
export interface MemberLeftEvent {
  kind: "memberLeft";
  /** The chat room id. */
  chatId: string;
  /** The member who left. */
  member: EventMember;
}

/** A member was kicked from the room. */
export interface MemberKickedEvent {
  kind: "memberKicked";
  /** The chat room id. */
  chatId: string;
  /** The member who was kicked. */
  member: EventMember;
}

/** A feed row whose feedType is not yet classified. */
export interface UnknownFeedEvent {
  kind: "unknownFeed";
  /** The chat room id. */
  chatId: string;
  /** The raw KakaoTalk feedType code. */
  feedType: number;
  /** The members named in the feed, if any. */
  members: EventMember[];
}

/**
 * A discriminated union of every open-chat event Zenith reports.
 */
export type RoomEvent =
  | TitleChangedEvent
  | HostChangedEvent
  | StaffAddedEvent
  | StaffRemovedEvent
  | MemberJoinedEvent
  | MemberLeftEvent
  | MemberKickedEvent
  | UnknownFeedEvent;

/**
 * A point-in-time snapshot of one open chat room's administrative state.
 *
 * Comparing two snapshots yields the title/host/staff/membership {@link RoomEvent}s that
 * KakaoTalk does not always record as feed rows.
 */
export interface RoomSnapshot {
  /** The chat room id. */
  chatId: string;
  /** The backing open link id, if resolved. */
  linkId?: string;
  /** The room title. */
  title?: string;
  /** The host/owner user id. */
  ownerId?: string;
  /** Each member's role code (`link_member_type`), keyed by user id. */
  memberTypes: Map<string, number>;
  /** Each member's last-seen nickname, keyed by user id. */
  nicknames: Map<string, string>;
}
