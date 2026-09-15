import { test } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encryptField, deriveKey, genSalt } from "../src/decrypt.js";

const CASES = [
  { encType: 0, userId: 0 },
  { encType: 1, userId: 435096401 },
  { encType: 2, userId: 435096401 },
  { encType: 15, userId: 12345 },
  { encType: 30, userId: 987654321 },
  { encType: 31, userId: 1 },
];

const SAMPLES = ["", "hello", "안녕하세요 테스트 메시지 🙂", "a".repeat(48), "open.kakao.com/o/gABCdef"];

test("round-trips every (encType, userId) sample", () => {
  for (const { encType, userId } of CASES) {
    for (const message of SAMPLES) {
      const cipher = encryptField(encType, message, userId);
      const plain = decrypt(encType, cipher, userId);
      assert.equal(plain, message, `encType=${encType} userId=${userId} msg=${JSON.stringify(message)}`);
    }
  }
});

test("decrypting an empty string returns an empty string", () => {
  assert.equal(decrypt(0, "", 0), "");
});

test("wrong userId does not recover the plaintext", () => {
  const cipher = encryptField(2, "secret-owner-code", 435096401);
  assert.notEqual(decrypt(2, cipher, 111111111), "secret-owner-code");
});

test("genSalt is always 16 bytes", () => {
  assert.equal(genSalt(435096401, 2).length, 16);
  assert.equal(genSalt(0, 5).length, 16);
});

test("genSalt rejects unknown encoding types", () => {
  assert.throws(() => genSalt(1, 99), RangeError);
});

test("deriveKey is deterministic and yields a 32-byte key", () => {
  const salt = genSalt(1, 2);
  const a = deriveKey(Buffer.from([1, 2, 3]), salt, 2, 32);
  const b = deriveKey(Buffer.from([1, 2, 3]), salt, 2, 32);
  assert.deepEqual(a, b);
  assert.equal(a.length, 32);
});
