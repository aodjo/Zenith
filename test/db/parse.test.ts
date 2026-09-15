import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COL_SEP,
  ROW_SEP,
  codeFromUrl,
  encFromV,
  isMineFromV,
  linkParamCode,
  parseIdArray,
  parseV,
  splitRows,
} from "../../src/db/parse.js";

test("splitRows parses control-char separated cells", () => {
  const raw = `1${COL_SEP}hi${ROW_SEP}2${COL_SEP}yo`;
  assert.deepEqual(splitRows(raw), [
    ["1", "hi"],
    ["2", "yo"],
  ]);
  assert.deepEqual(splitRows(""), []);
});

test("parseV tolerates missing or invalid JSON", () => {
  assert.deepEqual(parseV('{"enc":31}'), { enc: 31 });
  assert.deepEqual(parseV(""), {});
  assert.deepEqual(parseV("not json"), {});
});

test("encFromV reads the encoding type", () => {
  assert.equal(encFromV('{"enc":31,"isMine":false}'), 31);
  assert.equal(encFromV("{}"), 0);
});

test("isMineFromV is true only for isMine:true", () => {
  assert.equal(isMineFromV('{"isMine":true}'), true);
  assert.equal(isMineFromV('{"isMine":false}'), false);
  assert.equal(isMineFromV("{}"), false);
});

test("linkParamCode extracts l= from v.params", () => {
  assert.equal(linkParamCode('{"params":"l=gZX6QKNi&r=EW"}'), "gZX6QKNi");
  assert.equal(linkParamCode('{"params":"r=EW&l=abc123"}'), "abc123");
  assert.equal(linkParamCode("{}"), undefined);
});

test("codeFromUrl extracts the /o/ code", () => {
  assert.equal(codeFromUrl("https://open.kakao.com/o/gZX6QKNi"), "gZX6QKNi");
  assert.equal(codeFromUrl("https://example.com/x"), undefined);
});

test("parseIdArray keeps large ids as strings", () => {
  assert.deepEqual(parseIdArray("[4926470028626996896, 770103527]"), [
    "4926470028626996896",
    "770103527",
  ]);
  assert.deepEqual(parseIdArray("[]"), []);
  assert.deepEqual(parseIdArray(""), []);
});
