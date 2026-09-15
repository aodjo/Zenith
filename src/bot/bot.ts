import { Zenith, type ZenithOptions } from "../zenith.js";
import { TEXT_MESSAGE_TYPE } from "../observer/index.js";
import type { ChatObserver } from "../observer/index.js";
import type { EventObserver, EventMember } from "../events/index.js";
import type { Message } from "../db/index.js";

/** Synthetic message type for member-change events, which carry no chat message. */
const FEED_MESSAGE_TYPE = 0;

/** A chat-like event a handler can subscribe to. */
export type BotEvent = "chat" | "message" | "newMember" | "delMember";

/** A handler invoked with the context of a chat or member event. */
export type ChatHandler = (chat: ChatContext) => void | Promise<void>;

/** A handler invoked when an event handler throws. */
export type ErrorHandler = (error: unknown) => void;

/**
 * Options for constructing a {@link Bot}; the same as {@link ZenithOptions}.
 */
export type BotOptions = ZenithOptions;

/**
 * The room an event occurred in.
 */
export interface ChatRoom {
  /** The chat room id. */
  id: string;
  /** The room name, or empty string if not resolved. */
  name: string;
  /** The room type code (e.g. `"OM"`, `"OD"`). */
  type: string;
}

/**
 * The user who sent a message or who joined/left.
 */
export interface ChatSender {
  /** The user id. */
  id: string;
  /** The decrypted nickname, or empty string if not resolved. */
  name: string;
}

/**
 * A received message, split into command and parameter for easy dispatch.
 */
export interface ChatMessage {
  /** The `chat_logs._id` of the message. */
  id: number;
  /** The KakaoTalk message type (1 = text). */
  type: number;
  /** The full message text. */
  msg: string;
  /** The first whitespace-delimited word of the message. */
  command: string;
  /** The remainder of the message after the command. */
  param: string;
  /** Whether the message has any parameter after the command. */
  hasParam: boolean;
  /** Whether the bot account sent this message. */
  isMine: boolean;
  /** Creation time as a unix epoch (seconds). */
  createdAt: number;
}

/**
 * Splits a message into its command (first word) and parameter (the rest).
 *
 * @param {string} msg - The full message text.
 * @returns {{ command: string; param: string; hasParam: boolean }} The parsed parts.
 *
 * @example
 * parseCommand("!echo hello world"); // { command: "!echo", param: "hello world", hasParam: true }
 */
export function parseCommand(msg: string): { command: string; param: string; hasParam: boolean } {
  const trimmed = msg.trimStart();
  const space = trimmed.search(/\s/);
  if (space === -1) {
    return { command: trimmed, param: "", hasParam: false };
  }
  const param = trimmed.slice(space + 1).trim();
  return { command: trimmed.slice(0, space), param, hasParam: param.length > 0 };
}

/**
 * The context of a chat or member event, with a one-call reply.
 *
 * Mirrors the Iris `ChatContext`: it bundles the {@link ChatRoom}, {@link ChatSender},
 * and {@link ChatMessage}, and {@link ChatContext.reply} sends back to the same room
 * without the caller resolving links or ids.
 *
 * @example
 * bot.on("message", (chat) => {
 *   if (chat.message.command === "!ping") return chat.reply("pong");
 * });
 */
export class ChatContext {
  /** The room the event occurred in. */
  readonly room: ChatRoom;
  /** The user who sent the message (or joined/left). */
  readonly sender: ChatSender;
  /** The message. */
  readonly message: ChatMessage;
  private readonly replyFn: (text: string) => Promise<void>;

  /**
   * Builds a context from its parts and a bound reply function.
   *
   * @param {ChatRoom} room - The room the event occurred in.
   * @param {ChatSender} sender - The user who sent the message or joined/left.
   * @param {ChatMessage} message - The message.
   * @param {(text: string) => Promise<void>} replyFn - Sends text back to this room.
   *
   * @example
   * new ChatContext(room, sender, message, (t) => zenith.send(link, t));
   */
  constructor(
    room: ChatRoom,
    sender: ChatSender,
    message: ChatMessage,
    replyFn: (text: string) => Promise<void>,
  ) {
    this.room = room;
    this.sender = sender;
    this.message = message;
    this.replyFn = replyFn;
  }

  /**
   * Sends a text reply to the room this event came from.
   *
   * @param {string} text - The reply text (Korean supported).
   * @returns {Promise<void>} Resolves once the reply has been sent.
   *
   * @example
   * await chat.reply("안녕하세요");
   */
  reply(text: string): Promise<void> {
    return this.replyFn(text);
  }
}

/**
 * An event-driven KakaoTalk bot, in the style of Iris/irispy.
 *
 * Wraps a {@link Zenith} client and turns its message and room-event streams into simple
 * `on(event, handler)` subscriptions whose handler receives a {@link ChatContext} with a
 * one-call `reply`. This is the easiest entry point: construct, register handlers, run.
 *
 * @example
 * const bot = new Bot({ serial: "127.0.0.1:5555", defaultProfile: "bot" });
 * bot.on("message", (chat) => {
 *   if (chat.message.command === "!ping") return chat.reply("pong");
 * });
 * await bot.run();
 */
export class Bot {
  /** The underlying Zenith client (advanced use). */
  readonly zenith: Zenith;
  private readonly handlers = new Map<BotEvent, Set<ChatHandler>>();
  private readonly errorHandlers = new Set<ErrorHandler>();
  private readonly rooms = new Map<string, { name: string; type: string; link: string | undefined }>();
  private readonly memberNames = new Map<string, Map<string, string>>();
  private chatObserver: ChatObserver | undefined;
  private eventObserver: EventObserver | undefined;
  private stopResolver: (() => void) | undefined;

  /**
   * Creates a bot bound to one device.
   *
   * @param {BotOptions} options - The Zenith options (serial, adb path, bot id, default profile).
   *
   * @example
   * const bot = new Bot({ serial: "127.0.0.1:5555" });
   */
  constructor(options: BotOptions) {
    this.zenith = new Zenith(options);
  }

  /**
   * Registers a handler for a chat or member event.
   *
   * `"chat"` fires for every message, `"message"` for text messages only, and
   * `"newMember"`/`"delMember"` when someone joins or leaves. Multiple handlers per event
   * are supported.
   *
   * @param {BotEvent} event - The event to subscribe to.
   * @param {ChatHandler} handler - Called with the event's {@link ChatContext}.
   * @returns {() => void} A function that unregisters the handler.
   *
   * @example
   * bot.on("message", (chat) => chat.reply("hi"));
   */
  on(event: BotEvent, handler: ChatHandler): () => void {
    const set = this.handlers.get(event) ?? new Set<ChatHandler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  /**
   * Registers a handler for errors thrown by event handlers.
   *
   * @param {ErrorHandler} handler - Called with the thrown value.
   * @returns {() => void} A function that unregisters the handler.
   *
   * @example
   * bot.onError((e) => console.error(e));
   */
  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  /**
   * Loads the room cache and starts the message and event streams.
   *
   * Non-blocking: returns once the streams are running. Only messages and events after
   * this call are delivered.
   *
   * @async
   * @returns {Promise<void>} Resolves once the bot is listening.
   *
   * @example
   * await bot.start();
   */
  async start(): Promise<void> {
    await this.refreshRooms();
    this.chatObserver = await this.zenith.watchMessages((message) => {
      void this.handleMessage(message);
    });
    this.eventObserver = await this.zenith.watchEvents((event) => {
      if (event.kind === "memberJoined") void this.handleMember("newMember", event.chatId, event.member);
      else if (event.kind === "memberLeft") void this.handleMember("delMember", event.chatId, event.member);
    });
  }

  /**
   * Starts the bot and blocks until it is stopped.
   *
   * A convenience for a bot that is the process's main task; equivalent to {@link Bot.start}
   * followed by waiting forever.
   *
   * @async
   * @returns {Promise<void>} A promise that resolves only when {@link Bot.stop} is called.
   *
   * @example
   * await bot.run();
   */
  async run(): Promise<void> {
    await this.start();
    await new Promise<void>((resolve) => {
      this.stopResolver = resolve;
    });
  }

  /**
   * Stops the message and event streams.
   *
   * @returns {void} Nothing.
   *
   * @example
   * bot.stop();
   */
  stop(): void {
    this.chatObserver?.stop();
    this.eventObserver?.stop();
    this.stopResolver?.();
    this.stopResolver = undefined;
  }

  /**
   * Refreshes the cache of joined rooms (name, type, link) used to build contexts.
   *
   * @async
   * @returns {Promise<void>} Resolves once the cache is refreshed.
   *
   * @example
   * await bot.refreshRooms();
   */
  async refreshRooms(): Promise<void> {
    this.rooms.clear();
    for (const room of await this.zenith.rooms()) {
      this.rooms.set(room.chatId, {
        name: room.name ?? "",
        type: room.type,
        link: room.url ?? room.code,
      });
    }
  }

  /**
   * Dispatches a message to the "chat" and (for text) "message" handlers.
   *
   * @async
   * @param {Message} message - The observed message.
   * @returns {Promise<void>} Resolves once handlers have run.
   *
   * @example
   * await this.handleMessage(message);
   */
  private async handleMessage(message: Message): Promise<void> {
    const context = await this.buildContext(message);
    await this.dispatch("chat", context);
    if (message.type === TEXT_MESSAGE_TYPE) {
      await this.dispatch("message", context);
    }
  }

  /**
   * Dispatches a member join/leave to its handlers.
   *
   * @async
   * @param {BotEvent} event - Either `"newMember"` or `"delMember"`.
   * @param {string} chatId - The room the change occurred in.
   * @param {EventMember} member - The member who joined or left.
   * @returns {Promise<void>} Resolves once handlers have run.
   *
   * @example
   * await this.handleMember("newMember", "123", { userId: "9", nickname: "n" });
   */
  private async handleMember(
    event: BotEvent,
    chatId: string,
    member: EventMember,
  ): Promise<void> {
    const info = this.rooms.get(chatId);
    const room: ChatRoom = { id: chatId, name: info?.name ?? "", type: info?.type ?? "" };
    const sender: ChatSender = { id: member.userId, name: member.nickname ?? "" };
    const message: ChatMessage = {
      id: 0,
      type: FEED_MESSAGE_TYPE,
      msg: "",
      command: "",
      param: "",
      hasParam: false,
      isMine: false,
      createdAt: Math.floor(Date.now() / 1000),
    };
    await this.dispatch(event, new ChatContext(room, sender, message, this.replyTo(chatId)));
  }

  /**
   * Builds a {@link ChatContext} for a message, resolving room and sender names.
   *
   * @async
   * @param {Message} message - The observed message.
   * @returns {Promise<ChatContext>} The context, with a reply bound to the message's room.
   *
   * @example
   * const chat = await this.buildContext(message);
   */
  private async buildContext(message: Message): Promise<ChatContext> {
    if (!this.rooms.has(message.chatId)) {
      await this.refreshRooms();
    }
    const info = this.rooms.get(message.chatId);
    const room: ChatRoom = { id: message.chatId, name: info?.name ?? "", type: info?.type ?? "" };
    const sender: ChatSender = {
      id: message.userId,
      name: await this.senderName(message.chatId, message.userId),
    };
    const chatMessage: ChatMessage = {
      id: message.logId,
      type: message.type,
      msg: message.text,
      ...parseCommand(message.text),
      isMine: message.isMine,
      createdAt: message.createdAt,
    };
    return new ChatContext(room, sender, chatMessage, this.replyTo(message.chatId));
  }

  /**
   * Builds a reply function bound to a room, sending via the room's cached link.
   *
   * @param {string} chatId - The room to reply to.
   * @returns {(text: string) => Promise<void>} A reply function for that room.
   *
   * @example
   * const reply = this.replyTo("18474375066224479");
   */
  private replyTo(chatId: string): (text: string) => Promise<void> {
    return async (text: string) => {
      const link = this.rooms.get(chatId)?.link;
      if (!link) {
        throw new Error(`cannot reply: no link cached for room ${chatId}`);
      }
      await this.zenith.send(link, text);
    };
  }

  /**
   * Resolves (and caches) a member's nickname within a room.
   *
   * @async
   * @param {string} chatId - The room id.
   * @param {string} userId - The member's user id.
   * @returns {Promise<string>} The nickname, or empty string if unknown.
   *
   * @example
   * const name = await this.senderName("123", "9");
   */
  private async senderName(chatId: string, userId: string): Promise<string> {
    let byUser = this.memberNames.get(chatId);
    if (!byUser || !byUser.has(userId)) {
      byUser = new Map<string, string>();
      for (const member of await this.zenith.members(chatId)) {
        byUser.set(member.userId, member.nickname);
      }
      this.memberNames.set(chatId, byUser);
    }
    return byUser.get(userId) ?? "";
  }

  /**
   * Invokes every handler for an event, routing thrown errors to error handlers.
   *
   * @async
   * @param {BotEvent} event - The event whose handlers to run.
   * @param {ChatContext} context - The context to pass to each handler.
   * @returns {Promise<void>} Resolves once all handlers have settled.
   *
   * @example
   * await this.dispatch("message", context);
   */
  private async dispatch(event: BotEvent, context: ChatContext): Promise<void> {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        await handler(context);
      } catch (error) {
        for (const onError of this.errorHandlers) onError(error);
      }
    }
  }
}
