import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHierarchy } from "../../src/ui/hierarchy.js";
import { findNode, findNodes, matchNode } from "../../src/ui/selector.js";

const FIXTURE = `<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.kakao.talk" bounds="[0,0][1080,2280]">
    <node index="0" text="" resource-id="com.kakao.talk:id/search" content-desc="Search &amp; find" class="android.widget.ImageButton" clickable="true" enabled="true" bounds="[573,48][693,216]" />
    <node index="1" text="Friends" resource-id="com.kakao.talk:id/chip_friend" content-desc="Friends, tab" class="android.widget.Button" clickable="true" enabled="true" bounds="[48,216][294,330]" />
    <node index="2" text="Join" resource-id="" content-desc="" class="android.widget.TextView" clickable="false" enabled="false" bounds="[100,1000][300,1100]" />
  </node>
</hierarchy>`;

test("parseHierarchy reads attributes, bounds, and center", () => {
  const nodes = parseHierarchy(FIXTURE);
  assert.equal(nodes.length, 4);
  const search = nodes[1]!;
  assert.equal(search.resourceId, "com.kakao.talk:id/search");
  assert.equal(search.contentDesc, "Search & find");
  assert.equal(search.clickable, true);
  assert.deepEqual(search.bounds, { x1: 573, y1: 48, x2: 693, y2: 216 });
  assert.deepEqual(search.center, { x: 633, y: 132 });
});

test("findNode matches by bare resource-id name", () => {
  const nodes = parseHierarchy(FIXTURE);
  const node = findNode(nodes, { id: "chip_friend" });
  assert.equal(node?.text, "Friends");
});

test("findNode matches by content-desc substring", () => {
  const nodes = parseHierarchy(FIXTURE);
  const node = findNode(nodes, { descContains: "Search" });
  assert.equal(node?.resourceId, "com.kakao.talk:id/search");
});

test("matchNode requires all fields (AND)", () => {
  const nodes = parseHierarchy(FIXTURE);
  const friends = findNode(nodes, { text: "Friends" })!;
  assert.equal(matchNode(friends, { text: "Friends", clickable: true }), true);
  assert.equal(matchNode(friends, { text: "Friends", clickable: false }), false);
});

test("findNodes returns all clickable nodes", () => {
  const nodes = parseHierarchy(FIXTURE);
  assert.equal(findNodes(nodes, { clickable: true }).length, 2);
});
