import { test } from "node:test";
import assert from "node:assert/strict";
import { Zenith } from "../src/zenith.js";

test("constructs without touching the device and exposes low-level handles", () => {
  const zenith = new Zenith({ serial: "127.0.0.1:5555" });
  assert.ok(zenith.device);
  assert.ok(zenith.db);
  assert.ok(zenith.screen);
});

test("join rejects when no profile is given and no defaultProfile is set", async () => {
  const zenith = new Zenith({ serial: "127.0.0.1:5555" });
  await assert.rejects(zenith.join("https://open.kakao.com/o/xxxx"), /needs a profile/);
});
