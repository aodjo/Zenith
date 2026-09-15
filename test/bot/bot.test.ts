import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, ChatContext } from "../../src/bot/bot.js";

test("parseCommand splits command and parameter", () => {
  assert.deepEqual(parseCommand("!echo hello world"), {
    command: "!echo",
    param: "hello world",
    hasParam: true,
  });
  assert.deepEqual(parseCommand("!ping"), { command: "!ping", param: "", hasParam: false });
  assert.deepEqual(parseCommand("  spaced   arg "), {
    command: "spaced",
    param: "arg",
    hasParam: true,
  });
  assert.deepEqual(parseCommand(""), { command: "", param: "", hasParam: false });
});

test("ChatContext.reply forwards to its reply function", async () => {
  const sent: string[] = [];
  const context = new ChatContext(
    { id: "1", name: "room", type: "OM" },
    { id: "9", name: "sender" },
    { id: 1, type: 1, msg: "hi", command: "hi", param: "", hasParam: false, isMine: false, createdAt: 0 },
    async (text) => {
      sent.push(text);
    },
  );
  await context.reply("pong");
  assert.deepEqual(sent, ["pong"]);
});
