import type { Device } from "../device/index.js";
import { Screen } from "../ui/index.js";
import { OpenChat } from "../openchat/index.js";

/** IME component of ADBKeyBoard, used to inject Unicode (e.g. Korean) text. */
const ADB_KEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";

/** Broadcast action ADBKeyBoard listens on for base64-encoded UTF-8 input. */
const ADB_INPUT_B64_ACTION = "ADB_INPUT_B64";

/** resource-id of the chatroom message input field. */
const MESSAGE_INPUT_ID = "message_edit_text";

/** resource-id of the send button, which appears only once the input is non-empty. */
const SEND_BUTTON_ID = "send_button_layout";

/** resource-id present only inside an open chatroom (the media keyboard button). */
const CHATROOM_MARKER_ID = "media_send_layout";

/** Default per-step wait, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15000;

/** Poll interval while confirming the input cleared after send, in milliseconds. */
const CLEAR_POLL_MS = 300;

/** Number of clear-confirmation polls before giving up. */
const CLEAR_POLL_ATTEMPTS = 10;

/**
 * Thrown when ADBKeyBoard is not installed or cannot be activated as the input method.
 *
 * KakaoTalk messages are typed into the chat field, and `adb shell input text` transmits
 * only ASCII, so Korean and other Unicode require the ADBKeyBoard IME. If it is missing,
 * sending non-ASCII text is impossible and Zenith fails loudly rather than sending
 * mojibake.
 *
 * @example
 * try {
 *   await sender.send(link, "안녕");
 * } catch (e) {
 *   const needsIme = e instanceof AdbKeyboardUnavailableError;
 * }
 */
export class AdbKeyboardUnavailableError extends Error {
  /**
   * Builds the error.
   *
   * @example
   * throw new AdbKeyboardUnavailableError();
   */
  constructor() {
    super(
      `ADBKeyBoard IME (${ADB_KEYBOARD_IME}) is not active; install ADBKeyboard.apk and enable it`,
    );
    this.name = "AdbKeyboardUnavailableError";
  }
}

/**
 * Options for sending a message.
 */
export interface SendOptions {
  /** Per-step timeout override, in milliseconds. */
  timeoutMs?: number;
}

/**
 * Pauses for a number of milliseconds.
 *
 * @param {number} ms - How long to sleep.
 * @returns {Promise<void>} Resolves after the delay.
 *
 * @example
 * await sleep(300);
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Encodes message text as base64 UTF-8 for the ADBKeyBoard broadcast.
 *
 * The text is delivered via `am broadcast ... --es msg <value>`; adb reassembles shell
 * arguments by spaces, so a raw message with spaces would be split into the wrong extras.
 * Base64 is a single shell-safe token and preserves every Unicode code point.
 *
 * @param {string} text - The message text to send.
 * @returns {string} The base64-encoded UTF-8 of `text`.
 * @throws {RangeError} If `text` is empty (there would be no send button to tap).
 *
 * @example
 * encodeMessage("안녕"); // "7JWI64WV"
 */
export function encodeMessage(text: string): string {
  if (text.length === 0) {
    throw new RangeError("Cannot send an empty message");
  }
  return Buffer.from(text, "utf8").toString("base64");
}

/**
 * Sends text messages to KakaoTalk open chats by driving the chatroom UI.
 *
 * Opens the room, types the message through the ADBKeyBoard IME (so Korean and other
 * Unicode work, which `adb shell input text` cannot), and taps send. Each send runs
 * through the device's exclusive queue so it never interleaves with another operation on
 * the shared screen.
 *
 * An alternative, screen-free design is KakaoTalk's notification quick-reply
 * (`NotificationActionService` + `RemoteInput` via a root `IActivityManager` reflection,
 * as dolidolih/Iris does); it is more robust but needs an on-device app_process helper,
 * so this module uses the UI path, which is pure adb.
 *
 * @example
 * const sender = new Sender(device);
 * await sender.send("https://open.kakao.com/o/xxxx", "안녕하세요");
 */
export class Sender {
  private readonly device: Device;
  private readonly screen: Screen;

  /**
   * Wraps a device with message-sending automation.
   *
   * @param {Device} device - The device whose KakaoTalk to drive.
   *
   * @example
   * const sender = new Sender(new Device("127.0.0.1:5555"));
   */
  constructor(device: Device) {
    this.device = device;
    this.screen = new Screen(device);
  }

  /**
   * Opens an open chat, sending KakaoTalk to the chatroom (or preview if not joined).
   *
   * Uses KakaoTalk's `kakaoopen://join?l=<code>` deep link; the plain `open.kakao.com`
   * URL resolves to the device web browser instead of the app.
   *
   * @param {string} link - The open chat link (full URL or bare code).
   * @returns {Promise<void>} Resolves once the deep link has been dispatched.
   *
   * @example
   * await sender.open("https://open.kakao.com/o/xxxx");
   */
  private async open(link: string): Promise<void> {
    const code = OpenChat.linkCode(link);
    await this.device.shell("am", "start", "-a", "android.intent.action.VIEW", "-d", `kakaoopen://join?l=${code}`);
  }

  /**
   * Ensures ADBKeyBoard is the active input method so Unicode text can be typed.
   *
   * Returns immediately if it is already active; otherwise enables and selects it. The
   * change is left in place, since a dedicated bot device needs it for every send.
   *
   * @async
   * @returns {Promise<void>} Resolves once ADBKeyBoard is the active IME.
   * @throws {AdbKeyboardUnavailableError} If ADBKeyBoard cannot be enabled or selected.
   *
   * @example
   * await sender.ensureKeyboard();
   */
  async ensureKeyboard(): Promise<void> {
    const current = await this.device.shell("settings", "get", "secure", "default_input_method");
    if (current.includes("adbkeyboard")) {
      return;
    }
    try {
      await this.device.shell("ime", "enable", ADB_KEYBOARD_IME);
      await this.device.shell("ime", "set", ADB_KEYBOARD_IME);
    } catch {
      throw new AdbKeyboardUnavailableError();
    }
    const after = await this.device.shell("settings", "get", "secure", "default_input_method");
    if (!after.includes("adbkeyboard")) {
      throw new AdbKeyboardUnavailableError();
    }
  }

  /**
   * Waits until the message input has cleared, confirming the message was sent.
   *
   * @param {number} timeoutMs - Unused ceiling kept for signature symmetry with other waits.
   * @returns {Promise<boolean>} True if the input cleared, false if it still holds text.
   *
   * @example
   * const sent = await sender.confirmCleared(15000);
   */
  private async confirmCleared(timeoutMs: number): Promise<boolean> {
    void timeoutMs;
    for (let attempt = 0; attempt < CLEAR_POLL_ATTEMPTS; attempt++) {
      const input = await this.screen.find({ id: MESSAGE_INPUT_ID });
      if (input && input.text.length === 0) {
        return true;
      }
      await sleep(CLEAR_POLL_MS);
    }
    return false;
  }

  /**
   * Sends a text message to an open chat.
   *
   * Opens the room, focuses the message field, injects the text through ADBKeyBoard as
   * base64 (so Korean works), taps send, and confirms the input cleared. Runs
   * exclusively so no other queued operation touches the screen meanwhile.
   *
   * @async
   * @param {string} link - The open chat link (full URL or bare code).
   * @param {string} text - The message text (any Unicode).
   * @param {SendOptions} [options={}] - Optional timeout override.
   * @returns {Promise<void>} Resolves once the message has been sent and the input cleared.
   * @throws {RangeError} If `text` is empty.
   * @throws {AdbKeyboardUnavailableError} If the ADBKeyBoard IME cannot be activated.
   * @throws {Error} If the chatroom or send button never appears, or the input never clears.
   *
   * @example
   * await sender.send("https://open.kakao.com/o/gZX6QKNi", "젠쓰 전송 테스트");
   */
  async send(link: string, text: string, options: SendOptions = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const encoded = encodeMessage(text);
    await this.device.exclusive(async () => {
      await this.ensureKeyboard();
      await this.open(link);
      await this.screen.waitFor({ id: CHATROOM_MARKER_ID }, { timeoutMs });
      await this.screen.tap({ id: MESSAGE_INPUT_ID }, { timeoutMs });
      await this.device.shell("am", "broadcast", "-a", ADB_INPUT_B64_ACTION, "--es", "msg", encoded);
      await this.screen.tap({ id: SEND_BUTTON_ID }, { timeoutMs });
      if (!(await this.confirmCleared(timeoutMs))) {
        throw new Error(`Message input did not clear after sending to ${link}`);
      }
    });
  }
}
