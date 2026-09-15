import type { UiNode } from "./hierarchy.js";

/**
 * Selecting nodes from a parsed uiautomator hierarchy by stable identifiers.
 *
 * Finding an element by its resource-id, text, or content-description — then acting on
 * its current bounds — is what makes automation survive layout changes, versus tapping
 * fixed coordinates that break when anything moves.
 */

/**
 * A query describing which node to find. Every provided field must match (logical AND).
 */
export interface Selector {
  /** Match resource-id: full value, `pkg:id/name`, or bare `name` (segment after `/`). */
  id?: string;
  /** Match text exactly. */
  text?: string;
  /** Match nodes whose text contains this substring. */
  textContains?: string;
  /** Match content-desc exactly. */
  desc?: string;
  /** Match nodes whose content-desc contains this substring. */
  descContains?: string;
  /** Match class name exactly. */
  className?: string;
  /** Require the node's clickable flag to equal this. */
  clickable?: boolean;
}

/**
 * Tests whether a resource-id matches a selector's `id`, allowing a bare-name match.
 *
 * @param {string} resourceId - The node's full resource-id.
 * @param {string} wanted - The selector id: full value, `pkg:id/name`, or bare `name`.
 * @returns {boolean} True if the id matches fully or by trailing segment.
 *
 * @example
 * matchesId("com.kakao.talk:id/chip_friend", "chip_friend"); // true
 */
function matchesId(resourceId: string, wanted: string): boolean {
  if (!resourceId) return false;
  return resourceId === wanted || resourceId.endsWith(`/${wanted}`);
}

/**
 * Tests whether a node satisfies every field of a selector.
 *
 * @param {UiNode} node - The node to test.
 * @param {Selector} selector - The query; each present field must match.
 * @returns {boolean} True if all provided selector fields match the node.
 *
 * @example
 * matchNode(node, { desc: "Search" }); // true when node's content-desc is "Search"
 */
export function matchNode(node: UiNode, selector: Selector): boolean {
  if (selector.id !== undefined && !matchesId(node.resourceId, selector.id)) return false;
  if (selector.text !== undefined && node.text !== selector.text) return false;
  if (selector.textContains !== undefined && !node.text.includes(selector.textContains)) {
    return false;
  }
  if (selector.desc !== undefined && node.contentDesc !== selector.desc) return false;
  if (selector.descContains !== undefined && !node.contentDesc.includes(selector.descContains)) {
    return false;
  }
  if (selector.className !== undefined && node.className !== selector.className) return false;
  if (selector.clickable !== undefined && node.clickable !== selector.clickable) return false;
  return true;
}

/**
 * Finds the first node matching a selector.
 *
 * @param {UiNode[]} nodes - Nodes to search, as returned by `parseHierarchy`.
 * @param {Selector} selector - The query.
 * @returns {UiNode | undefined} The first matching node, or undefined if none match.
 *
 * @example
 * const search = findNode(nodes, { desc: "Search" });
 */
export function findNode(nodes: UiNode[], selector: Selector): UiNode | undefined {
  return nodes.find((n) => matchNode(n, selector));
}

/**
 * Finds every node matching a selector.
 *
 * @param {UiNode[]} nodes - Nodes to search.
 * @param {Selector} selector - The query.
 * @returns {UiNode[]} All matching nodes, in document order.
 *
 * @example
 * const buttons = findNodes(nodes, { className: "android.widget.Button" });
 */
export function findNodes(nodes: UiNode[], selector: Selector): UiNode[] {
  return nodes.filter((n) => matchNode(n, selector));
}
