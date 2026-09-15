import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Default adb executable name; override per device for non-PATH installs. */
const DEFAULT_ADB = "adb";

/** Upper bound on bytes buffered from one adb invocation; screenshots run a few MB. */
const MAX_BUFFER = 64 * 1024 * 1024;

/** On-device path used to stage the UI hierarchy dump before reading it back. */
const UI_DUMP_PATH = "/sdcard/zenith_ui.xml";

/**
 * Options controlling how a {@link Device} shells out to adb.
 */
export interface DeviceOptions {
  /** Path to the adb executable. Defaults to `"adb"` on PATH. */
  adbPath?: string;
}

/**
 * A single Android device or emulator addressed over adb.
 *
 * Wraps `adb -s <serial>` so the rest of Zenith never builds adb command lines by
 * hand. Every method spawns adb with argument arrays (never a shell string), so
 * device serials and payloads are not subject to host-shell interpretation. Intended
 * to target a rooted Redroid instance but works against any adb-reachable device.
 *
 * @example
 * const device = new Device("127.0.0.1:5555", { adbPath: "/home/u/platform-tools/adb" });
 * await device.tap(633, 132);
 */
export class Device {
  private readonly serial: string;
  private readonly adbPath: string;

  /**
   * Creates a handle to one adb-addressable device.
   *
   * @param {string} serial - The adb serial (e.g. `"127.0.0.1:5555"` or `"emulator-5554"`).
   * @param {DeviceOptions} [options={}] - Optional adb path override.
   *
   * @example
   * const device = new Device("127.0.0.1:5555");
   */
  constructor(serial: string, options: DeviceOptions = {}) {
    this.serial = serial;
    this.adbPath = options.adbPath ?? DEFAULT_ADB;
  }

  /**
   * Runs a command in the device shell and returns its stdout as text.
   *
   * The command is passed as separate tokens to `adb -s <serial> shell`, which the
   * device shell then executes; each token becomes one shell word.
   *
   * @param {...string} command - The shell command and its arguments as separate tokens.
   * @returns {Promise<string>} The command's stdout, trailing newline trimmed.
   * @throws {Error} If adb exits non-zero (e.g. device offline).
   *
   * @example
   * const model = await device.shell("getprop", "ro.product.model");
   */
  async shell(...command: string[]): Promise<string> {
    const { stdout } = await execFileAsync(this.adbPath, ["-s", this.serial, "shell", ...command], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    return stdout.replace(/\r/g, "").replace(/\n$/, "");
  }

  /**
   * Runs a device command and returns its stdout as raw bytes.
   *
   * Uses `adb exec-out`, which streams binary output without the line-ending
   * translation `shell` applies, so it is safe for screenshots and file contents.
   *
   * @param {...string} command - The command and its arguments as separate tokens.
   * @returns {Promise<Buffer>} The command's stdout as bytes.
   * @throws {Error} If adb exits non-zero.
   *
   * @example
   * const png = await device.execOut("screencap", "-p");
   */
  async execOut(...command: string[]): Promise<Buffer> {
    const { stdout } = await execFileAsync(
      this.adbPath,
      ["-s", this.serial, "exec-out", ...command],
      { encoding: "buffer", maxBuffer: MAX_BUFFER },
    );
    return stdout as Buffer;
  }

  /**
   * Taps a single screen coordinate.
   *
   * This is the raw positional primitive; prefer selector-based tapping via `Screen`
   * so a shifted layout does not send the tap to the wrong place.
   *
   * @param {number} x - Horizontal pixel coordinate.
   * @param {number} y - Vertical pixel coordinate.
   * @returns {Promise<void>} Resolves once the tap has been injected.
   *
   * @example
   * await device.tap(633, 132);
   */
  async tap(x: number, y: number): Promise<void> {
    await this.shell("input", "tap", String(Math.round(x)), String(Math.round(y)));
  }

  /**
   * Swipes between two coordinates over a duration.
   *
   * Useful for scrolling a list into view before locating an element.
   *
   * @param {number} x1 - Start horizontal coordinate.
   * @param {number} y1 - Start vertical coordinate.
   * @param {number} x2 - End horizontal coordinate.
   * @param {number} y2 - End vertical coordinate.
   * @param {number} [durationMs=300] - Swipe duration in milliseconds.
   * @returns {Promise<void>} Resolves once the swipe has been injected.
   *
   * @example
   * await device.swipe(540, 1500, 540, 500, 400); // scroll up
   */
  async swipe(x1: number, y1: number, x2: number, y2: number, durationMs = 300): Promise<void> {
    await this.shell(
      "input",
      "swipe",
      String(Math.round(x1)),
      String(Math.round(y1)),
      String(Math.round(x2)),
      String(Math.round(y2)),
      String(durationMs),
    );
  }

  /**
   * Types ASCII text into the focused field.
   *
   * `adb shell input text` only transmits ASCII; spaces are encoded as `%s`. Non-ASCII
   * text (e.g. Korean) must be entered another way (clipboard or an IME) and is
   * rejected here rather than silently mistyped.
   *
   * @param {string} text - The ASCII text to type.
   * @returns {Promise<void>} Resolves once the text has been injected.
   * @throws {RangeError} If `text` contains a non-ASCII character.
   *
   * @example
   * await device.inputText("1234"); // an open-chat passcode
   */
  async inputText(text: string): Promise<void> {
    if (/[^\x20-\x7e]/.test(text)) {
      throw new RangeError("inputText only supports ASCII; use clipboard/IME for other text");
    }
    await this.shell("input", "text", text.replace(/ /g, "%s"));
  }

  /**
   * Sends a key event by Android key code.
   *
   * @param {number} keyCode - The Android `KEYCODE_*` value (e.g. 4 = BACK, 66 = ENTER).
   * @returns {Promise<void>} Resolves once the key event has been injected.
   *
   * @example
   * await device.key(4); // BACK
   */
  async key(keyCode: number): Promise<void> {
    await this.shell("input", "keyevent", String(keyCode));
  }

  /**
   * Captures the current screen as PNG bytes.
   *
   * @returns {Promise<Buffer>} The screenshot encoded as PNG.
   *
   * @example
   * await writeFile("shot.png", await device.screencap());
   */
  async screencap(): Promise<Buffer> {
    return this.execOut("screencap", "-p");
  }

  /**
   * Dumps the current window's UI hierarchy as uiautomator XML.
   *
   * Writes the hierarchy to a staging file on the device, then reads it back, because
   * `uiautomator dump` prints only a status line to stdout. The returned XML is the
   * input to {@link parseHierarchy}.
   *
   * @returns {Promise<string>} The uiautomator XML for the foreground window.
   * @throws {Error} If the dump cannot be produced (e.g. the window is mid-animation).
   *
   * @example
   * const xml = await device.dumpUi();
   * const nodes = parseHierarchy(xml);
   */
  async dumpUi(): Promise<string> {
    await this.shell("uiautomator", "dump", UI_DUMP_PATH);
    const xml = await this.execOut("cat", UI_DUMP_PATH);
    return xml.toString("utf8");
  }
}
