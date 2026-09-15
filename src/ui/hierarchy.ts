/**
 * Parsing of Android uiautomator hierarchy dumps.
 *
 * Turns the XML from {@link Device.dumpUi} into a flat list of nodes carrying their
 * stable identifiers (resource-id, text, content-desc) and on-screen bounds. Querying
 * those nodes lives in `./selector`; driving the screen lives in `./screen`.
 */

/** Pixel rectangle of a node: top-left (x1,y1) to bottom-right (x2,y2). */
export interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A screen coordinate. */
export interface Point {
  x: number;
  y: number;
}

/**
 * One element from a uiautomator hierarchy, with the fields Zenith selects and taps on.
 */
export interface UiNode {
  /** Visible text of the element. */
  text: string;
  /** Full resource-id, e.g. `com.kakao.talk:id/chip_friend`. */
  resourceId: string;
  /** Accessibility content-description. */
  contentDesc: string;
  /** Fully-qualified widget class name. */
  className: string;
  /** Owning package name. */
  packageName: string;
  /** Whether the element reports itself as clickable. */
  clickable: boolean;
  /** Whether the element is enabled. */
  enabled: boolean;
  /** The element's pixel rectangle. */
  bounds: Bounds;
  /** Center of {@link UiNode.bounds}, the point to tap. */
  center: Point;
}

/** XML entities uiautomator emits inside attribute values. */
const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/**
 * Decodes the XML entities that appear in uiautomator attribute values.
 *
 * @param {string} value - A raw attribute value from the dump.
 * @returns {string} The value with `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&apos;` decoded.
 *
 * @example
 * unescapeXml("Tom &amp; Jerry"); // "Tom & Jerry"
 */
function unescapeXml(value: string): string {
  return value.replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, (m) => XML_ENTITIES[m] ?? m);
}

/**
 * Parses a `[x1,y1][x2,y2]` bounds string into a rectangle and its center.
 *
 * @param {string} raw - The bounds attribute value.
 * @returns {{ bounds: Bounds; center: Point }} The rectangle and its center point.
 *
 * @example
 * parseBounds("[573,48][693,216]"); // { bounds: {x1:573,...}, center: {x:633,y:132} }
 */
function parseBounds(raw: string): { bounds: Bounds; center: Point } {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(raw);
  const [x1, y1, x2, y2] = m ? m.slice(1).map(Number) : [0, 0, 0, 0];
  const bounds: Bounds = { x1: x1!, y1: y1!, x2: x2!, y2: y2! };
  return { bounds, center: { x: Math.round((x1! + x2!) / 2), y: Math.round((y1! + y2!) / 2) } };
}

/**
 * Parses a uiautomator XML dump into a flat list of nodes.
 *
 * Scans every `<node>` start tag and reads its attributes; tree depth is not retained
 * because selection is by identity, not by ancestry. Missing attributes become empty
 * strings or `false` so callers never handle `undefined`.
 *
 * @param {string} xml - The XML produced by {@link Device.dumpUi}.
 * @returns {UiNode[]} All nodes in document order.
 *
 * @example
 * const nodes = parseHierarchy(await device.dumpUi());
 * nodes.length; // e.g. 101
 */
export function parseHierarchy(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  const tagRe = /<node\b([^>]*?)\/?>/g;
  const attrRe = /([\w:-]+)="([^"]*)"/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(xml)) !== null) {
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(tag[1]!)) !== null) {
      attrs[a[1]!] = unescapeXml(a[2]!);
    }
    const { bounds, center } = parseBounds(attrs["bounds"] ?? "");
    nodes.push({
      text: attrs["text"] ?? "",
      resourceId: attrs["resource-id"] ?? "",
      contentDesc: attrs["content-desc"] ?? "",
      className: attrs["class"] ?? "",
      packageName: attrs["package"] ?? "",
      clickable: attrs["clickable"] === "true",
      enabled: attrs["enabled"] === "true",
      bounds,
      center,
    });
  }
  return nodes;
}
