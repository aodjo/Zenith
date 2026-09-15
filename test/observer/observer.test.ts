import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatObserver } from "../../src/observer/observer.js";
import type { Message, MessageSource } from "../../src/db/types.js";

const msg = (logId: number, chatId: string): Message => ({
  logId,
  chatId,
  userId: "1",
  type: 1,
  text: `m${logId}`,
  createdAt: 0,
  isMine: false,
});

class FakeSource implements MessageSource {
  all: Message[] = [];
  async maxLogId(): Promise<number> {
    return this.all.reduce((max, m) => Math.max(max, m.logId), 0);
  }
  async messagesSince(lastLogId: number, limit = 200): Promise<Message[]> {
    return this.all.filter((m) => m.logId > lastLogId).slice(0, limit);
  }
}

test("start seeds to max id and does not replay history", async () => {
  const source = new FakeSource();
  source.all = [msg(1, "a"), msg(2, "a")];
  const seen: number[] = [];
  const observer = new ChatObserver(source);
  observer.onMessage((m) => seen.push(m.logId));
  await observer.start();
  const emitted = await observer.poll();
  observer.stop();
  assert.deepEqual(seen, []);
  assert.deepEqual(emitted, []);
});

test("emits only messages newer than the seed and advances the cursor", async () => {
  const source = new FakeSource();
  source.all = [msg(5, "a")];
  const seen: number[] = [];
  const observer = new ChatObserver(source);
  observer.onMessage((m) => seen.push(m.logId));
  await observer.start();
  source.all.push(msg(6, "a"), msg(7, "a"));
  await observer.poll();
  source.all.push(msg(8, "a"));
  await observer.poll();
  observer.stop();
  assert.deepEqual(seen, [6, 7, 8]);
});

test("textOnly emits plain text and skips feed/system rows", async () => {
  const source = new FakeSource();
  source.all = [];
  const seen: number[] = [];
  const observer = new ChatObserver(source, { textOnly: true });
  observer.onMessage((m) => seen.push(m.logId));
  await observer.start();
  source.all.push({ ...msg(1, "a"), type: 0 }, msg(2, "a"), { ...msg(3, "a"), type: 0 });
  const emitted = await observer.poll();
  observer.stop();
  assert.deepEqual(
    emitted.map((m) => m.logId),
    [2],
  );
  assert.deepEqual(seen, [2]);
});

test("chatId filter advances the cursor past filtered rows", async () => {
  const source = new FakeSource();
  source.all = [];
  const seen: number[] = [];
  const observer = new ChatObserver(source, { chatId: "a" });
  observer.onMessage((m) => seen.push(m.logId));
  await observer.start();
  source.all.push(msg(1, "a"), msg(2, "b"), msg(3, "a"));
  const emitted = await observer.poll();
  observer.stop();
  assert.deepEqual(
    emitted.map((m) => m.logId),
    [1, 3],
  );
  assert.deepEqual(seen, [1, 3]);
});
