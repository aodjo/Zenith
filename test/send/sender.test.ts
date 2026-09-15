import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeMessage } from "../../src/send/sender.js";

test("encodeMessage base64-encodes UTF-8 and round-trips", () => {
  for (const text of ["hello", "젠쓰 전송 테스트", "a b c", "emoji 🙂", "줄1\n줄2"]) {
    const encoded = encodeMessage(text);
    assert.match(encoded, /^[A-Za-z0-9+/]+=*$/);
    assert.equal(Buffer.from(encoded, "base64").toString("utf8"), text);
  }
});

test("encodeMessage produces a shell-safe token (no spaces)", () => {
  assert.ok(!encodeMessage("젠쓰 전송 테스트").includes(" "));
});

test("encodeMessage rejects empty text", () => {
  assert.throws(() => encodeMessage(""), RangeError);
});
