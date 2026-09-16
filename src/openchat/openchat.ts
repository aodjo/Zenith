import type { Device } from "../device/device.js";
import { Screen } from "../ui/screen.js";
import { findNode } from "../ui/selector.js";
import type { UiNode } from "../ui/hierarchy.js";

/** Default per-step wait, in milliseconds; join includes a possible cold app start. */
const DEFAULT_TIMEOUT_MS = 15000;

/** Gap between hierarchy polls while advancing through the join screens. */
const POLL_MS = 300;

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

/** Title text of the passcode dialog shown when a room requires a chatroom code. */
const PASSCODE_TITLE = "Chatroom Code";

/** resource-id of the passcode input field in the passcode dialog. */
const PASSCODE_FIELD_ID = "edit_text";

/** Text of the passcode dialog's confirm button. */
const PASSCODE_DONE_TEXT = "Done";

/** Time to wait for the profile sheet after a passcode before treating it as rejected. */
const PASSCODE_RESULT_MS = 8000;

/**
 * Android KEYCODE_HOME. Pressed right after a join to send KakaoTalk to the background.
 * KakaoTalk raises no notification for a room it is foregrounded on, so a freshly joined
 * room left in the foreground never populates a NotificationReferer — and the RemoteInput
 * reply path has no referer to send under. Backgrounding restores normal notifications so
 * the room's later messages can be replied to.
 */
const KEYCODE_HOME = 3;

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
 * Thrown when a room requires a passcode but none was provided.
 *
 * @example
 * try { await openChat.join({ link, profile }); }
 * catch (e) { const needsCode = e instanceof PasscodeRequiredError; }
 */
export class PasscodeRequiredError extends Error {
  /** The open chat link that requires a passcode. */
  readonly link: string;

  /**
   * Builds the error from the link that demanded a passcode.
   *
   * @param {string} link - The open chat link.
   *
   * @example
   * throw new PasscodeRequiredError("https://open.kakao.com/o/xxxx");
   */
  constructor(link: string) {
    super(`Open chat ${link} requires a passcode; pass options.passcode`);
    this.name = "PasscodeRequiredError";
    this.link = link;
  }
}

/**
 * Thrown when the supplied passcode is rejected by the room.
 *
 * @example
 * try { await openChat.join({ link, profile, passcode: "0000" }); }
 * catch (e) { const wrong = e instanceof PasscodeIncorrectError; }
 */
export class PasscodeIncorrectError extends Error {
  /** The open chat link whose passcode was rejected. */
  readonly link: string;

  /**
   * Builds the error from the link whose passcode was wrong.
   *
   * @param {string} link - The open chat link.
   *
   * @example
   * throw new PasscodeIncorrectError("https://open.kakao.com/o/xxxx");
   */
  constructor(link: string) {
    super(`Passcode was rejected for open chat ${link}`);
    this.name = "PasscodeIncorrectError";
    this.link = link;
  }
}

/**
 * Thrown when a join is attempted for a room the bot is already in.
 *
 * Opening the link lands in the chatroom rather than the preview, so there is nothing to
 * join. Callers that re-issue joins (e.g. re-verification) should treat this as "already
 * present" rather than a failure.
 *
 * @example
 * try { await openChat.join({ link, profile }); }
 * catch (e) { const alreadyIn = e instanceof AlreadyJoinedError; }
 */
export class AlreadyJoinedError extends Error {
  /** The open chat link that was already joined. */
  readonly link: string;

  /**
   * Builds the error from the link that was already joined.
   *
   * @param {string} link - The open chat link.
   *
   * @example
   * throw new AlreadyJoinedError("https://open.kakao.com/o/xxxx");
   */
  constructor(link: string) {
    super(`Already joined open chat ${link}`);
    this.name = "AlreadyJoinedError";
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
  /** The chatroom code, for a passcode-protected room (ASCII). */
  passcode?: string;
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
   * @param {JoinOptions} options - The link, the profile to enter with, an optional passcode, and an optional timeout.
   * @returns {Promise<JoinResult>} The joined room's title.
   * @throws {ProfileUnavailableError} If the requested profile is not in the join sheet.
   * @throws {PasscodeRequiredError} If the room needs a passcode and none was given.
   * @throws {PasscodeIncorrectError} If the supplied passcode is rejected.
   * @throws {Error} If a step's element never appears (e.g. the room could not be opened).
   *
   * @example
   * const { title } = await openChat.join({
   *   link: "https://open.kakao.com/o/gZX6QKNi",
   *   profile: ".",
   *   passcode: "1234",
   * });
   */
  async join(options: JoinOptions): Promise<JoinResult> {
    const { link, profile } = options;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return this.device.exclusive(async () => {
      await this.open(link);
      const joinButton = await this.detectJoinScreen(link, timeoutMs);
      await this.device.tap(joinButton.center.x, joinButton.center.y);
      const row = await this.reachProfileRow(link, profile, options.passcode, timeoutMs);
      await this.device.tap(row.center.x, row.center.y);
      const nodes = await this.waitForChatroom(timeoutMs);
      const title = findNode(nodes, { id: CHATROOM_TITLE_ID });
      // Leave the app backgrounded so this room's later messages arrive as notifications.
      await this.device.key(KEYCODE_HOME);
      return { title: title?.contentDesc ?? "" };
    });
  }

  /**
   * Waits for the link preview and returns its "Join Open Chat" button.
   *
   * If the bot is already a member, opening the link lands in the chatroom instead of the
   * preview; this detects that and throws {@link AlreadyJoinedError} rather than waiting
   * out the timeout for a join button that will never appear.
   *
   * @async
   * @param {string} link - The open chat link, for error context.
   * @param {number} timeoutMs - How long to wait for the preview.
   * @returns {Promise<UiNode>} The join button node to tap.
   * @throws {AlreadyJoinedError} If the bot is already in the room.
   * @throws {Error} If neither the preview nor the chatroom appears in time.
   *
   * @example
   * const joinButton = await this.detectJoinScreen(link, 15000);
   */
  private async detectJoinScreen(link: string, timeoutMs: number): Promise<UiNode> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const nodes = await this.screen.dump();
      if (findNode(nodes, { id: CHATROOM_MARKER_ID })) {
        throw new AlreadyJoinedError(link);
      }
      const joinButton = findNode(nodes, { id: JOIN_BUTTON_ID });
      if (joinButton) return joinButton;
      if (Date.now() >= deadline) {
        throw new Error(`join: link preview not reached for ${link}`);
      }
      await sleep(POLL_MS);
    }
  }

  /**
   * Advances to the profile sheet and returns the requested profile's row.
   *
   * Polls the screen once per cycle and reuses each dump: it enters the chatroom code
   * when the passcode dialog appears, and when the profile sheet appears it locates the
   * requested profile's row in the same hierarchy. Merging these steps removes the extra
   * UI dumps that dominate join latency.
   *
   * @async
   * @param {string} link - The open chat link, for error context.
   * @param {string} profile - The profile name to select.
   * @param {string | undefined} passcode - The chatroom code, if the room needs one.
   * @param {number} timeoutMs - Overall time to reach the profile sheet.
   * @returns {Promise<UiNode>} The profile row node to tap.
   * @throws {ProfileUnavailableError} If the profile is not offered by the room.
   * @throws {PasscodeRequiredError} If a passcode is required but not supplied.
   * @throws {PasscodeIncorrectError} If the supplied passcode is rejected.
   * @throws {Error} If the profile sheet is never reached.
   *
   * @example
   * const row = await this.reachProfileRow(link, "bot", "1234", 15000);
   */
  private async reachProfileRow(
    link: string,
    profile: string,
    passcode: string | undefined,
    timeoutMs: number,
  ): Promise<UiNode> {
    const deadline = Date.now() + timeoutMs;
    let passcodeEnteredAt = 0;
    for (;;) {
      const nodes = await this.screen.dump();
      if (findNode(nodes, { text: PROFILE_SHEET_TITLE })) {
        const row = findNode(nodes, { id: PROFILE_NAME_ID, text: profile });
        if (row) return row;
        throw new ProfileUnavailableError(profile, link);
      }
      if (passcodeEnteredAt === 0 && findNode(nodes, { text: PASSCODE_TITLE })) {
        if (passcode === undefined) throw new PasscodeRequiredError(link);
        const field = findNode(nodes, { id: PASSCODE_FIELD_ID });
        const done = findNode(nodes, { text: PASSCODE_DONE_TEXT });
        if (field && done) {
          await this.device.tap(field.center.x, field.center.y);
          await this.device.inputText(passcode);
          await this.device.tap(done.center.x, done.center.y);
          passcodeEnteredAt = Date.now();
        }
      } else if (passcodeEnteredAt !== 0 && Date.now() - passcodeEnteredAt > PASSCODE_RESULT_MS) {
        throw new PasscodeIncorrectError(link);
      }
      if (Date.now() >= deadline) {
        throw new Error(`join: profile sheet not reached for ${link}`);
      }
      await sleep(POLL_MS);
    }
  }

  /**
   * Waits for the chatroom to load and returns its full hierarchy.
   *
   * Returns the node list so the caller can read the room title from the same dump that
   * detected the chatroom, avoiding an extra UI dump.
   *
   * @async
   * @param {number} timeoutMs - How long to wait for the chatroom.
   * @returns {Promise<UiNode[]>} The chatroom's nodes.
   * @throws {Error} If the chatroom does not load in time.
   *
   * @example
   * const nodes = await this.waitForChatroom(15000);
   */
  private async waitForChatroom(timeoutMs: number): Promise<UiNode[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const nodes = await this.screen.dump();
      if (findNode(nodes, { id: CHATROOM_MARKER_ID })) return nodes;
      if (Date.now() >= deadline) throw new Error("join: chatroom did not load");
      await sleep(POLL_MS);
    }
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
