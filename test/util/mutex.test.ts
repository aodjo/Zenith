import { test } from "node:test";
import assert from "node:assert/strict";
import { Mutex } from "../../src/util/mutex.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("runs exclusive sections one at a time in FIFO order", async () => {
  const mutex = new Mutex();
  const events: string[] = [];
  const section = (name: string, ms: number) =>
    mutex.runExclusive(async () => {
      events.push(`${name}:start`);
      await sleep(ms);
      events.push(`${name}:end`);
    });

  await Promise.all([section("a", 40), section("b", 10), section("c", 10)]);

  assert.deepEqual(events, [
    "a:start",
    "a:end",
    "b:start",
    "b:end",
    "c:start",
    "c:end",
  ]);
});

test("a rejected section does not break the queue", async () => {
  const mutex = new Mutex();
  const results: string[] = [];

  const failing = mutex.runExclusive(async () => {
    throw new Error("boom");
  });
  const following = mutex.runExclusive(async () => {
    results.push("ran");
  });

  await assert.rejects(failing, /boom/);
  await following;
  assert.deepEqual(results, ["ran"]);
});

test("returns the section's resolved value", async () => {
  const mutex = new Mutex();
  assert.equal(await mutex.runExclusive(async () => 42), 42);
});
