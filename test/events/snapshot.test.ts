import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots, snapshotRooms, type RoomStateSource } from "../../src/events/snapshot.js";
import type { RoomSnapshot } from "../../src/events/types.js";
import type { Member, Room } from "../../src/db/index.js";

const snap = (
  chatId: string,
  fields: { title?: string; ownerId?: string; members: Array<[string, number, string?]> },
): RoomSnapshot => {
  const memberTypes = new Map<string, number>();
  const nicknames = new Map<string, string>();
  for (const [userId, type, nick] of fields.members) {
    memberTypes.set(userId, type);
    if (nick) nicknames.set(userId, nick);
  }
  const s: RoomSnapshot = { chatId, memberTypes, nicknames };
  if (fields.title !== undefined) s.title = fields.title;
  if (fields.ownerId !== undefined) s.ownerId = fields.ownerId;
  return s;
};

test("diffSnapshots detects a title change", () => {
  const prev = new Map([["1", snap("1", { title: "A", members: [] })]]);
  const next = new Map([["1", snap("1", { title: "B", members: [] })]]);
  const events = diffSnapshots(prev, next);
  assert.deepEqual(events, [{ kind: "titleChanged", chatId: "1", previousTitle: "A", title: "B" }]);
});

test("diffSnapshots detects a host change", () => {
  const prev = new Map([["1", snap("1", { ownerId: "o1", members: [] })]]);
  const next = new Map([["1", snap("1", { ownerId: "o2", members: [] })]]);
  const events = diffSnapshots(prev, next);
  assert.equal(events[0]!.kind, "hostChanged");
  assert.equal(events[0]!.kind === "hostChanged" && events[0]!.ownerId, "o2");
});

test("diffSnapshots detects co-admin add and remove by role code", () => {
  const prev = new Map([["1", snap("1", { members: [["u", 2, "n"]] })]]);
  const promoted = new Map([["1", snap("1", { members: [["u", 4, "n"]] })]]);
  assert.equal(diffSnapshots(prev, promoted)[0]!.kind, "staffAdded");
  assert.equal(diffSnapshots(promoted, prev)[0]!.kind, "staffRemoved");
});

test("diffSnapshots detects joins and leaves", () => {
  const prev = new Map([["1", snap("1", { members: [["a", 2]] })]]);
  const next = new Map([["1", snap("1", { members: [["b", 2, "bob"]] })]]);
  const kinds = diffSnapshots(prev, next).map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["memberJoined", "memberLeft"]);
});

test("diffSnapshots ignores rooms present in only one snapshot", () => {
  const prev = new Map<string, RoomSnapshot>();
  const next = new Map([["1", snap("1", { title: "A", members: [["a", 2]] })]]);
  assert.deepEqual(diffSnapshots(prev, next), []);
});

test("snapshotRooms builds snapshots from a room-state source", async () => {
  const rooms: Room[] = [
    { chatId: "1", type: "OM", linkId: "L", name: "Room", ownerId: "o", memberIds: ["u1"], memberCount: 2 },
  ];
  const members: Member[] = [{ userId: "u1", nickname: "n1", memberType: 4 }];
  const source: RoomStateSource = {
    listJoinedRooms: async () => rooms,
    listMembers: async () => members,
  };
  const snapshots = await snapshotRooms(source);
  const one = snapshots.get("1")!;
  assert.equal(one.title, "Room");
  assert.equal(one.ownerId, "o");
  assert.equal(one.memberTypes.get("u1"), 4);
  assert.equal(one.nicknames.get("u1"), "n1");
});
