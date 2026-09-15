import type { Device } from "../device/device.js";
import { parseHierarchy, type UiNode } from "./hierarchy.js";
import { findNode, type Selector } from "./selector.js";

/** Default time to keep polling for an element before giving up, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 8000;

/** Default gap between hierarchy polls, in milliseconds. */
const DEFAULT_INTERVAL_MS = 400;

/**
 * Options for polling waits.
 */
export interface WaitOptions {
  /** Total time to wait before throwing, in milliseconds. */
  timeoutMs?: number;
  /** Delay between polls, in milliseconds. */
  intervalMs?: number;
}

/**
 * Pauses for a number of milliseconds.
 *
 * @param {number} ms - How long to sleep.
 * @returns {Promise<void>} Resolves after the delay.
 *
 * @example
 * await sleep(400);
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * High-level, selector-driven control of a device screen.
 *
 * Reads the live UI hierarchy and acts on elements by their stable identifiers
 * (resource-id, text, content-desc), computing each tap from the element's current
 * bounds. Because every action re-reads the hierarchy, the same code keeps working when
 * a layout moves — the fragility of hard-coded coordinates is avoided.
 *
 * @example
 * const screen = new Screen(device);
 * await screen.tap({ desc: "Search" });
 */
export class Screen {
  private readonly device: Device;

  /**
   * Wraps a {@link Device} with selector-based screen actions.
   *
   * @param {Device} device - The device to drive.
   *
   * @example
   * const screen = new Screen(new Device("127.0.0.1:5555"));
   */
  constructor(device: Device) {
    this.device = device;
  }

  /**
   * Reads and parses the current UI hierarchy.
   *
   * @returns {Promise<UiNode[]>} The nodes currently on screen.
   * @throws {Error} If the hierarchy cannot be dumped.
   *
   * @example
   * const nodes = await screen.dump();
   */
  async dump(): Promise<UiNode[]> {
    return parseHierarchy(await this.device.dumpUi());
  }

  /**
   * Finds a node once, without waiting.
   *
   * @param {Selector} selector - The query.
   * @returns {Promise<UiNode | undefined>} The first match, or undefined if absent right now.
   *
   * @example
   * const node = await screen.find({ id: "chip_friend" });
   */
  async find(selector: Selector): Promise<UiNode | undefined> {
    return findNode(await this.dump(), selector);
  }

  /**
   * Reports whether a node is present right now.
   *
   * @param {Selector} selector - The query.
   * @returns {Promise<boolean>} True if a matching node is on screen.
   *
   * @example
   * const present = await screen.exists({ text: "Join" });
   */
  async exists(selector: Selector): Promise<boolean> {
    return (await this.find(selector)) !== undefined;
  }

  /**
   * Polls the hierarchy until a node appears or the timeout elapses.
   *
   * @param {Selector} selector - The query.
   * @param {WaitOptions} [options={}] - Timeout and poll interval overrides.
   * @returns {Promise<UiNode>} The matched node.
   * @throws {Error} If no matching node appears before the timeout.
   *
   * @example
   * const join = await screen.waitFor({ text: "Join" }, { timeoutMs: 5000 });
   */
  async waitFor(selector: Selector, options: WaitOptions = {}): Promise<UiNode> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const node = await this.find(selector);
      if (node) return node;
      if (Date.now() >= deadline) {
        throw new Error(`waitFor timed out after ${timeoutMs}ms: ${JSON.stringify(selector)}`);
      }
      await sleep(intervalMs);
    }
  }

  /**
   * Scrolls the screen upward until a node matching the selector appears.
   *
   * Some targets (e.g. a "Leave chatroom" button at the end of a settings list) start
   * below the fold. This swipes up repeatedly, re-reading the hierarchy after each swipe,
   * and returns the node once visible. Swipe geometry assumes a roughly 1080x1920 screen.
   *
   * @param {Selector} selector - The element to reveal.
   * @param {number} [maxSwipes=6] - Maximum number of upward swipes to attempt.
   * @returns {Promise<UiNode>} The revealed node.
   * @throws {Error} If the element is not found after `maxSwipes` swipes.
   *
   * @example
   * const leave = await screen.scrollTo({ text: "Leave chatroom" });
   */
  async scrollTo(selector: Selector, maxSwipes = 6): Promise<UiNode> {
    for (let attempt = 0; attempt <= maxSwipes; attempt++) {
      const node = await this.find(selector);
      if (node) return node;
      await this.device.swipe(540, 1400, 540, 600, 300);
      await sleep(500);
    }
    throw new Error(`scrollTo did not reveal ${JSON.stringify(selector)} after ${maxSwipes} swipes`);
  }

  /**
   * Waits for a node, then taps the center of its current bounds.
   *
   * @param {Selector} selector - The element to tap.
   * @param {WaitOptions} [options={}] - Timeout and poll interval overrides.
   * @returns {Promise<UiNode>} The node that was tapped.
   * @throws {Error} If the element never appears.
   *
   * @example
   * await screen.tap({ desc: "Search" });
   */
  async tap(selector: Selector, options: WaitOptions = {}): Promise<UiNode> {
    const node = await this.waitFor(selector, options);
    await this.device.tap(node.center.x, node.center.y);
    return node;
  }

  /**
   * Taps a field, then types ASCII text into it.
   *
   * @param {Selector} selector - The field to focus.
   * @param {string} text - The ASCII text to type.
   * @param {WaitOptions} [options={}] - Timeout and poll interval overrides.
   * @returns {Promise<void>} Resolves once the text has been typed.
   * @throws {Error} If the field never appears.
   * @throws {RangeError} If `text` is not ASCII.
   *
   * @example
   * await screen.typeInto({ id: "passcode" }, "1234");
   */
  async typeInto(selector: Selector, text: string, options: WaitOptions = {}): Promise<void> {
    await this.tap(selector, options);
    await this.device.inputText(text);
  }
}
