/**
 * Pure parsing helpers for KakaoTalk database rows.
 *
 * The on-device sqlite3 is too old for JSON output, so Zenith reads rows using rare
 * control-character separators and parses them here. These functions are free of any
 * device or I/O so they can be unit-tested against fixtures; the transport and SQL live
 * in {@link KakaoDb}.
 */

/** Row separator passed to sqlite3 `-newline` (ASCII Record Separator). */
export const ROW_SEP = "\x1e";

/** Column separator passed to sqlite3 `-separator` (ASCII Unit Separator). */
export const COL_SEP = "\x1f";

/**
 * Splits raw sqlite3 output (separated by {@link ROW_SEP}/{@link COL_SEP}) into cells.
 *
 * Trailing empty output yields an empty array. Each row becomes an array of string
 * cells; SQL NULLs arrive as empty strings, which callers coerce as needed.
 *
 * @param {string} raw - The stdout produced by sqlite3 with the control-char separators.
 * @returns {string[][]} Rows of string cells, in query order.
 *
 * @example
 * splitRows("1\x1fhi\x1e2\x1fyo"); // [["1","hi"],["2","yo"]]
 */
export function splitRows(raw: string): string[][] {
  if (raw.length === 0) return [];
  return raw
    .split(ROW_SEP)
    .filter((row) => row.length > 0)
    .map((row) => row.split(COL_SEP));
}

/**
 * Parses a KakaoTalk `v` JSON blob into a plain object, tolerating malformed input.
 *
 * Several tables store per-row metadata as a JSON string in a `v` column. A missing or
 * invalid blob yields an empty object so callers never throw on bad data.
 *
 * @param {string} v - The raw `v` column value.
 * @returns {Record<string, unknown>} The parsed object, or `{}` if it cannot be parsed.
 *
 * @example
 * parseV('{"enc":31,"isMine":false}'); // { enc: 31, isMine: false }
 */
export function parseV(v: string): Record<string, unknown> {
  if (!v) return {};
  try {
    const parsed: unknown = JSON.parse(v);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Reads the encoding type (`enc`) from a message row's `v` blob.
 *
 * `chat_logs` rows keep the AES encoding type inside `v` rather than in a column; this is
 * the encoding to pass to {@link decrypt} for the message body.
 *
 * @param {string} v - The raw `v` column value.
 * @returns {number} The encoding type, or 0 when absent.
 *
 * @example
 * encFromV('{"enc":31}'); // 31
 */
export function encFromV(v: string): number {
  const enc = parseV(v)["enc"];
  return typeof enc === "number" ? enc : Number(enc) || 0;
}

/**
 * Reports whether a message row was sent by the logged-in account.
 *
 * @param {string} v - The raw `v` column value.
 * @returns {boolean} True when `v.isMine` is exactly `true`.
 *
 * @example
 * isMineFromV('{"isMine":true}'); // true
 */
export function isMineFromV(v: string): boolean {
  return parseV(v)["isMine"] === true;
}

/**
 * Extracts the open chat link code from a chat room's `v.params` string.
 *
 * Joined open rooms record how they were entered as `"params":"l=<code>&..."`; the code
 * links a `chat_rooms` row back to its `open_link`.
 *
 * @param {string} v - The raw `v` column value of a `chat_rooms` row.
 * @returns {string | undefined} The link code, or undefined if not present.
 *
 * @example
 * linkParamCode('{"params":"l=gZX6QKNi&r=EW"}'); // "gZX6QKNi"
 */
export function linkParamCode(v: string): string | undefined {
  const params = parseV(v)["params"];
  if (typeof params !== "string") return undefined;
  const m = /(?:^|&)l=([A-Za-z0-9]+)/.exec(params);
  return m ? m[1] : undefined;
}

/**
 * Extracts the open chat link code from a full `open.kakao.com/o/<code>` URL.
 *
 * @param {string} url - The open link URL.
 * @returns {string | undefined} The code, or undefined if the URL has none.
 *
 * @example
 * codeFromUrl("https://open.kakao.com/o/gZX6QKNi"); // "gZX6QKNi"
 */
export function codeFromUrl(url: string): string | undefined {
  const m = /\/o\/([A-Za-z0-9]+)/.exec(url);
  return m ? m[1] : undefined;
}

/**
 * Parses a KakaoTalk id-array column (e.g. `active_member_ids`) into id strings.
 *
 * Ids exceed JavaScript's safe integer range, so they are kept as strings rather than
 * numbers to avoid precision loss.
 *
 * @param {string} raw - The raw column value, a JSON-style array such as `[1, 2]`.
 * @returns {string[]} The ids as strings, in order; empty for `[]` or blank input.
 *
 * @example
 * parseIdArray("[4926470028626996896, 770103527]"); // ["4926470028626996896","770103527"]
 */
export function parseIdArray(raw: string): string[] {
  const inner = raw.replace(/^\s*\[/, "").replace(/\]\s*$/, "").trim();
  if (inner.length === 0) return [];
  return inner
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
