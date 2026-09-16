import type { Device } from "../device/device.js";
import { KAKAO_REPLY_DEX_JAR_BASE64 } from "./reply-dex.js";

/** On-device path the reply helper jar is written to. */
const DEVICE_JAR_PATH = "/data/local/tmp/zenith-reply.jar";

/** Main class inside the helper jar. */
const HELPER_CLASS = "KakaoReply";

/** Pause after backgrounding KakaoTalk so the notification referer is populated. */
const BACKGROUND_SETTLE_MS = 600;

/** Android key code for HOME (backgrounds the foreground app). */
const KEYCODE_HOME = 3;

/**
 * Pauses for a number of milliseconds.
 *
 * @param {number} ms - How long to sleep.
 * @returns {Promise<void>} Resolves after the delay.
 *
 * @example
 * await sleep(600);
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends messages through KakaoTalk's notification quick-reply (RemoteInput) path.
 *
 * Instead of opening the chatroom and typing, this pushes a tiny root helper (an
 * app_process jar) once, backgrounds KakaoTalk so its `NotificationReferer` is set, then
 * hands the helper a chat id and text; the helper builds the reply intent and lets
 * KakaoTalk deliver it. This is far faster than the UI path and does not bring KakaoTalk
 * to the foreground. It requires root and the target room to be joined.
 *
 * @example
 * const sender = new RemoteReplySender(device);
 * await sender.send("18474375066224479", "안녕하세요");
 */
export class RemoteReplySender {
  private readonly device: Device;
  private installed = false;

  /**
   * Binds the sender to a device.
   *
   * @param {Device} device - The device whose KakaoTalk to send through.
   *
   * @example
   * const sender = new RemoteReplySender(device);
   */
  constructor(device: Device) {
    this.device = device;
  }

  /**
   * Writes the helper jar to the device once, decoding it from the embedded base64.
   *
   * @returns {Promise<void>} Resolves once the jar is present on the device.
   * @throws {Error} If the write fails.
   *
   * @example
   * await sender.ensureInstalled();
   */
  async ensureInstalled(): Promise<void> {
    if (this.installed) return;
    // Pass the pipeline as separate tokens: adb joins them and the device shell runs the
    // pipe/redirect. Wrapping in `sh -c "..."` would be flattened by adb and break it.
    await this.device.shell(
      "printf",
      "%s",
      KAKAO_REPLY_DEX_JAR_BASE64,
      "|",
      "base64",
      "-d",
      ">",
      DEVICE_JAR_PATH,
    );
    this.installed = true;
  }

  /**
   * Sends a text message to a joined chat via the notification reply path.
   *
   * Runs exclusively (the device queue). Backgrounds KakaoTalk first so the reply intent
   * carries a valid referer, then invokes the root helper with the chat id and the text
   * (passed base64-encoded so any characters, including Korean, survive the shell).
   *
   * @param {string | number} chatId - The chat room id to send to (the bot must be a member).
   * @param {string} text - The message text.
   * @returns {Promise<void>} Resolves once the helper reports success.
   * @throws {Error} If the helper does not confirm the send.
   *
   * @example
   * await sender.send("18474375066224479", "방장 인증이 끝났어요.");
   */
  async send(chatId: string | number, text: string): Promise<void> {
    return this.device.exclusive(async () => {
      await this.ensureInstalled();
      await this.device.key(KEYCODE_HOME);
      await sleep(BACKGROUND_SETTLE_MS);
      const encoded = Buffer.from(text, "utf8").toString("base64");
      const out = await this.device.shell(
        "su",
        "0",
        "env",
        `CLASSPATH=${DEVICE_JAR_PATH}`,
        "app_process",
        "/",
        HELPER_CLASS,
        String(chatId),
        encoded,
      );
      if (!out.includes("OK ")) {
        throw new Error(`RemoteInput reply failed for chat ${chatId}: ${out.trim()}`);
      }
    });
  }
}
