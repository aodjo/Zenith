import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFeed, parseFeed } from "../../src/events/parse.js";

const JOIN = '{"feedType":4,"members":[{"userId":7701035270796385044,"nickName":"Ryan Cheering"}]}';
const SET_TYPE = '{"feedType":11,"member":{"userId":7701035270796385044,"nickName":"Ryan"}}';

test("decodeFeed preserves large user ids exactly as strings", () => {
  const decoded = decodeFeed(JOIN);
  assert.equal(decoded.feedType, 4);
  assert.equal(decoded.members.length, 1);
  assert.equal(decoded.members[0]!.userId, "7701035270796385044");
  assert.equal(decoded.members[0]!.nickname, "Ryan Cheering");
});

test("decodeFeed reads the singular member shape", () => {
  const decoded = decodeFeed(SET_TYPE);
  assert.equal(decoded.feedType, 11);
  assert.equal(decoded.members[0]!.userId, "7701035270796385044");
});

test("decodeFeed throws when feedType is absent", () => {
  assert.throws(() => decodeFeed('{"members":[]}'), /feedType/);
});

test("parseFeed classifies a join", () => {
  const event = parseFeed(JOIN, "123");
  assert.equal(event.kind, "memberJoined");
  assert.equal(event.kind === "memberJoined" && event.member.userId, "7701035270796385044");
});

test("parseFeed classifies leave, kick, and host handover", () => {
  assert.equal(parseFeed('{"feedType":2,"member":{"userId":1}}', "x").kind, "memberLeft");
  assert.equal(parseFeed('{"feedType":6,"member":{"userId":1}}', "x").kind, "memberKicked");
  assert.equal(parseFeed('{"feedType":14,"member":{"userId":9}}', "x").kind, "hostChanged");
});

test("parseFeed classifies co-admin grant (11) and revoke (12)", () => {
  assert.equal(parseFeed(SET_TYPE, "123").kind, "staffAdded");
  assert.equal(parseFeed('{"feedType":12,"member":{"userId":1}}', "123").kind, "staffRemoved");
});

test("parseFeed returns unknownFeed for an unrecognized type", () => {
  const event = parseFeed('{"feedType":999,"members":[]}', "123");
  assert.equal(event.kind, "unknownFeed");
});
