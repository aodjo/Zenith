import type { Device } from "../device/device.js";
import { Screen } from "../ui/screen.js";
import { findNode } from "../ui/selector.js";

/** Default per-step wait, in milliseconds; join includes a possible cold app start. */
const DEFAULT_TIMEOUT_MS = 15000;

/** resource-id of the "Join Open Chat" button on the link preview screen. */
const JOIN_BUTTON_ID = "join_layout";

/** Title text of the profile-selection bottom sheet shown after tapping join. */
const PROFILE_SHEET_TITLE = "Profile";

/** resource-id of the per-profile name label in the profile sheet and settings. */
const PROFILE_NAME_ID = "profile_name";

/** resource-id present only inside an open chatroom (the message input bar). */
const CHATROOM_MARKER_ID = "media_send_layout";

/** resource-id of the chatroom toolbar title (its content-desc is the room name). */
const CHATROOM_TITLE_ID = "toolbar_default_title_text";

/** content-desc of the chatroom toolbar "More" button that opens the side drawer. */
const MORE_DESC = "More";

/** content-desc of the drawer "Settings" gear that opens Chatroom Settings. */
const SETTINGS_DESC = "Settings";

/** resource-id of the "Leave chatroom" button at the end of Chatroom Settings. */
const LEAVE_BUTTON_ID = "setting_button";

/** Text of the "Leave chatroom" button. */
const LEAVE_BUTTON_TEXT = "Leave chatroom";

/** Text of the confirm button in the leave dialog. */
const LEAVE_CONFIRM_TEXT = "Leave";

/**
 * Thrown when the profile chosen for a join is not offered by the room.
 *
 * KakaoTalk only lists a room's permitted profiles in the join sheet. If the selected
 * profile is absent — for example a room that allows only the main profile — joining
 * with it is impossible, and Zenith refuses rather than silently entering under a
 * different identity.
 *
 * @example
 * try {
 *   await openChat.join({ link, profile: "bot" });
 * } catch (e) {
 *   const skipped = e instanceof ProfileUnavailableError;
 * }
 */
export class ProfileUnavailableError extends Error {
  /** The profile name that was requested but not offered. */
  readonly profile: string;
  /** The open chat link that was being joined. */
  readonly link: string;

  /**
   * Builds the error with the profile and link that failed.
   *
   * @param {string} profile - The requested profile name.
   * @param {string} link - The open chat link.
   *
   * @example
   * throw new ProfileUnavailableError("bot", "https://open.kakao.com/o/xxxx");
   */
  constructor(profile: string, link: string) {
    super(`Profile "${profile}" is not available to join ${link}`);
    this.name = "ProfileUnavailableError";
    this.profile = profile;
    this.link = link;
  }
}

/**
 * Options for joining an open chat.
 */
export interface JoinOptions {
  /** The open chat invite link (e.g. `https://open.kakao.com/o/xxxxxxxx`). */
  link: string;
  /** The exact profile name to enter with, as shown in the join profile sheet. */
  profile: string;
  /** Per-step timeout override, in milliseconds. */
  timeoutMs?: number;
}

/**
 * The outcome of a successful join.
 */
export interface JoinResult {
  /** The joined room's title, read from the chatroom toolbar. */
  title: string;
}

/**
 * Joins and leaves KakaoTalk open chats by driving the app's UI.
 *
 * Each operation runs through the device's exclusive queue, so concurrent joins or
 * leaves never interleave their taps on the shared screen. Every step locates its target
 * by stable identifier and taps the element's live bounds, so the flows tolerate layout
 * shifts and fail safely if the screen is not where expected.
 *
 * @example
 * const openChat = new OpenChat(device);
 * await openChat.join({ link: "https://open.kakao.com/o/xxxx", profile: "." });
 */
export class OpenChat {
  private readonly device: Device;
  private readonly screen: Screen;

  /**
   * Wraps a device with open-chat join/leave automation.
   *
   * @param {Device} device - The device whose KakaoTalk to drive.
   *
   * @example
   * const openChat = new OpenChat(new Device("127.0.0.1:5555"));
   */
  constructor(device: Device) {
    this.device = device;
    this.screen = new Screen(device);
  }

  /**
   * Extracts the open chat link code from a full link or returns a bare code unchanged.
   *
   * @param {string} link - A full `https://open.kakao.com/o/<code>` link or the code itself.
   * @returns {string} The link code (the `<code>` segment).
   * @throws {Error} If no code can be extracted.
   *
   * @example
   * OpenChat.linkCode("https://open.kakao.com/o/gZX6QKNi"); // "gZX6QKNi"
   */
  static linkCode(link: string): string {
    const fromUrl = /\/o\/([A-Za-z0-9]+)/.exec(link);
    if (fromUrl) return fromUrl[1]!;
    if (/^[A-Za-z0-9]+$/.test(link)) return link;
    throw new Error(`Cannot extract open chat code from "${link}"`);
  }

  /**
   * Opens an open chat, sending KakaoTalk to the preview (or chatroom, if already joined).
   *
   * Fires KakaoTalk's `kakaoopen://join?l=<code>` deep link, handled by the app's
   * OpenLinkConnection activity. This is deterministic: the plain `open.kakao.com` URL
   * resolves to the device web browser instead, so it must not be used to drive the app.
   *
   * @param {string} link - The open chat link (full URL or bare code).
   * @returns {Promise<void>} Resolves once the deep link has been dispatched.
   *
   * @example
   * await openChat.open("https://open.kakao.com/o/xxxx");
   */
  private async open(link: string): Promise<void> {
    const code = OpenChat.linkCode(link);
    await this.device.shell("am", "start", "-a", "android.intent.action.VIEW", "-d", `kakaoopen://join?l=${code}`);
  }

  /**
   * Joins an open chat under a specific profile.
   *
   * Opens the link's preview, taps "Join Open Chat", and selects the requested profile
   * from the profile sheet. If that profile is not offered, throws
   * {@link ProfileUnavailableError} instead of joining under another identity. Runs
   * exclusively so no other queued operation touches the screen meanwhile.
   *
   * @async
   * @param {JoinOptions} options - The link, the profile to enter with, and an optional timeout.
   * @returns {Promise<JoinResult>} The joined room's title.
   * @throws {ProfileUnavailableError} If the requested profile is not in the join sheet.
   * @throws {Error} If a step's element never appears (e.g. the room could not be opened).
   *
   * @example
   * const { title } = await openChat.join({
   *   link: "https://open.kakao.com/o/gZX6QKNi",
   *   profile: ".",
   * });
   */
  async join(options: JoinOptions): Promise<JoinResult> {
    const { link, profile } = options;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return this.device.exclusive(async () => {
      await this.open(link);
      await this.screen.tap({ id: JOIN_BUTTON_ID }, { timeoutMs });
      await this.screen.waitFor({ text: PROFILE_SHEET_TITLE }, { timeoutMs });
      const row = await this.screen.find({ id: PROFILE_NAME_ID, text: profile });
      if (!row) {
        throw new ProfileUnavailableError(profile, link);
      }
      await this.device.tap(row.center.x, row.center.y);
      await this.screen.waitFor({ id: CHATROOM_MARKER_ID }, { timeoutMs });
      const title = findNode(await this.screen.dump(), { id: CHATROOM_TITLE_ID });
      return { title: title?.contentDesc ?? "" };
    });
  }

  /**
   * Leaves an open chat.
   *
   * Opens the room, then drives More → Settings → "Leave chatroom" → confirm. Runs
   * exclusively so it never interleaves with another operation.
   *
   * @async
   * @param {string} link - The open chat link of the room to leave.
   * @param {number} [timeoutMs=15000] - Per-step timeout override, in milliseconds.
   * @returns {Promise<void>} Resolves once the leave has been confirmed.
   * @throws {Error} If a step's element never appears (e.g. the room is not joined).
   *
   * @example
   * await openChat.leave("https://open.kakao.com/o/gZX6QKNi");
   */
  async leave(link: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
    await this.device.exclusive(async () => {
      await this.open(link);
      await this.screen.waitFor({ id: CHATROOM_MARKER_ID }, { timeoutMs });
      await this.screen.tap({ desc: MORE_DESC }, { timeoutMs });
      await this.screen.tap({ desc: SETTINGS_DESC }, { timeoutMs });
      const leaveButton = await this.screen.scrollTo({ id: LEAVE_BUTTON_ID, text: LEAVE_BUTTON_TEXT });
      await this.device.tap(leaveButton.center.x, leaveButton.center.y);
      await this.screen.tap({ text: LEAVE_CONFIRM_TEXT }, { timeoutMs });
    });
  }
}
