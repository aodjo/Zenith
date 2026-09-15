import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpenChatType, OPEN_CHAT_TYPES, NotOpenChatError } from "../../src/db/kakao-db.js";

test("isOpenChatType accepts open chat types and rejects regular ones", () => {
  assert.equal(isOpenChatType("OM"), true);
  assert.equal(isOpenChatType("OD"), true);
  for (const type of ["DirectChat", "MultiChat", "PlusChat", "", "om"]) {
    assert.equal(isOpenChatType(type), false);
  }
  assert.deepEqual([...OPEN_CHAT_TYPES], ["OM", "OD"]);
});

test("NotOpenChatError carries the chat id and type", () => {
  const error = new NotOpenChatError("455007773985318", "DirectChat");
  assert.equal(error.chatId, "455007773985318");
  assert.equal(error.type, "DirectChat");
  assert.match(error.message, /not an open chat/);
});
