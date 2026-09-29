import type { Level } from '@overstory/sprout/lang';
import { PROTOCOL, type ServerMessage } from '@overstory/sprout/core';

import { link, tokenFor, type Link } from './connection.js';
import { CLIENT_COMMANDS, typedOf } from './input.js';
import { add, EMPTY, received, troubled, type ClientState } from './state.js';

// One visitor connected to one server: `hello` with the person's token,
// then admission to a world under a nickname, then every line typed sent
// as a command, each with its own `seq`, and every client command answered
// here. A line typed before admission is the nickname asked for; a
// nickname refused asks for another. `/reconnect` connects again with the
// same token, so the server finds the visit again. Every change is told to
// whoever shows the client.

/** What a session is started with. */
export interface SessionOptions {
  /** `host:port`, or a `ws://` or `wss://` URL. */
  readonly address: string;
  /** The world to come into; left out, the server's only one. */
  readonly world?: string;
  /** The nickname to ask for; left out, the first line typed. */
  readonly nickname?: string;
  /** Where the person's tokens are kept. */
  readonly tokens?: string;
  /** The client's name, as `hello` gives it. */
  readonly client?: string;
  /** The client's clock, in milliseconds, which dates an error; the real one where left out. */
  readonly now?: () => number;
}

/** A session with a server: its state, and what it does with each line typed. */
export class Session {
  state: ClientState = EMPTY;
  /** The levels shown: prose and errors, and whatever `/log` adds. */
  shown: ReadonlySet<Level> = new Set<Level>(['prose', 'error']);
  private connection: Link | null = null;
  private seq = 0;
  private nickname: string | null;
  /** Whether a nickname has been asked for and not yet admitted or refused. */
  private admitting = false;
  /** Lines typed while coming in, sent once in. */
  private waiting: string[] = [];
  /** The `seq` of each line sent whose effects have not come back. */
  private readonly answering = new Set<number>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: SessionOptions) {
    this.nickname = options.nickname ?? null;
  }

  /** The server connected to, as it was given. */
  get address(): string {
    return this.options.address;
  }

  /** The client's time, in milliseconds. */
  now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Call `listener` on every change; the returned call stops it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Connect, say `hello`, and come in where a nickname is already given. */
  async open(): Promise<void> {
    this.state = { ...this.state, closed: null };
    // A nickname already chosen is asked for as soon as the server welcomes; lines typed meanwhile wait.
    this.admitting = this.nickname !== null;
    // A connection closed after another replaced it, as on `/reconnect`, or before it opened, is not this session's.
    let opened: Link | null = null;
    opened = await link(this.options.address, {
      message: (message) => {
        if (opened !== null && this.connection === opened) this.receive(message);
      },
      malformed: (words) => this.change(troubled(add(this.state, 'refused', words), this.now())),
      closed: () => {
        if (opened === null || this.connection !== opened) return;
        this.connection = null;
        if (this.state.closed === null) {
          const lost = add(
            this.state,
            'client',
            'The connection to the server was lost: /reconnect to connect again, or /quit.',
          );
          this.change({ ...lost, world: null, closed: 'lost' });
        }
      },
    });
    this.connection = opened;
    this.connection.send({
      t: 'hello',
      protocol: PROTOCOL,
      client: this.options.client ?? 'sprout-tui',
      token: tokenFor(this.options.address, this.options.tokens),
      renders: [],
    });
  }

  /** What the visitor typed, sent or answered. Resolves to whether the client should go on. */
  async type(line: string): Promise<boolean> {
    const typed = typedOf(line);
    if ('nothing' in typed) return true;
    if ('unknown' in typed) {
      this.change(add(this.state, 'client', typed.unknown));
      return true;
    }
    if ('client' in typed) {
      switch (typed.client) {
        case 'help':
          this.change(
            CLIENT_COMMANDS.reduce(
              (now, one) => add(now, 'client', `${one.usage} — ${one.does}`),
              this.state,
            ),
          );
          return true;
        case 'reconnect':
          this.connection?.close();
          try {
            await this.open();
          } catch (error) {
            const words = error instanceof Error ? error.message : String(error);
            this.change({
              ...add(this.state, 'client', `${words}: /reconnect to try again, or /quit.`),
              closed: 'lost',
            });
          }
          return true;
        case 'quit':
          if (this.state.world !== null) this.connection?.send({ t: 'leave' });
          else this.connection?.close();
          return false;
      }
    }
    if ('log' in typed) {
      const shown = new Set(this.shown);
      if (shown.has(typed.log)) shown.delete(typed.log);
      else shown.add(typed.log);
      this.shown = shown;
      this.connection?.send({ t: 'levels', show: [...shown] });
      this.change(
        add(this.state, 'client', `${typed.log} is ${shown.has(typed.log) ? 'shown' : 'hidden'}.`),
      );
      return true;
    }
    if (this.connection === null || this.state.closed !== null) {
      this.change(
        add(this.state, 'client', 'Not connected: /reconnect to connect again, or /quit.'),
      );
      return true;
    }
    if ('say' in typed) {
      this.connection.send({ t: 'chat', line: typed.say });
      return true;
    }
    if (this.admitting) {
      this.waiting.push(typed.world);
      return true;
    }
    if (this.state.world === null) {
      this.nickname = typed.world;
      this.admitting = true;
      // Before the server's welcome there is no world to ask for; it is asked for then.
      if (this.state.worlds.length > 0) this.admit();
      return true;
    }
    this.seq += 1;
    this.answering.add(this.seq);
    this.change(add(this.state, 'typed', `> ${typed.world}`));
    this.connection.send({ t: 'command', seq: this.seq, line: typed.world });
    return true;
  }

  /**
   * Resolves once nothing is waiting on the server: coming in answered,
   * every line typed meanwhile sent, and every line sent answered; or once
   * the connection is gone.
   */
  idle(): Promise<void> {
    const done = () =>
      this.connection === null ||
      this.state.closed !== null ||
      (!this.admitting && this.waiting.length === 0 && this.answering.size === 0);
    return new Promise((resolve) => {
      if (done()) return resolve();
      const stop = this.onChange(() => {
        if (!done()) return;
        stop();
        resolve();
      });
    });
  }

  private receive(message: ServerMessage): void {
    if (message.t === 'effects' && message.seq !== null && message.last)
      this.answering.delete(message.seq);
    this.change(received(this.state, message, this.now()));
    if (message.t === 'welcome') {
      if (this.nickname === null)
        this.change(add(this.state, 'client', 'Type the nickname to be known by here.'));
      else this.admit();
    }
    if (message.t === 'refused' && message.stage === 'admit') {
      this.admitting = false;
      const dropped = this.waiting.length;
      this.waiting = [];
      const unsent =
        dropped === 0
          ? ''
          : ` ${dropped === 1 ? 'The line' : `The ${dropped} lines`} typed meanwhile ${dropped === 1 ? 'was' : 'were'} not sent.`;
      this.change(add(this.state, 'client', `Type another nickname.${unsent}`));
    }
    if (message.t === 'admitted') {
      this.admitting = false;
      this.connection?.send({ t: 'levels', show: [...this.shown] });
      const waiting = this.waiting;
      this.waiting = [];
      for (const line of waiting) void this.type(line);
    }
  }

  /** Ask to come into the chosen world, or the only one, under the nickname given. */
  private admit(): void {
    const world =
      this.options.world ?? (this.state.worlds.length === 1 ? this.state.worlds[0]! : null);
    if (world === null) {
      this.admitting = false;
      this.change(
        add(
          this.state,
          'client',
          `This server serves ${this.state.worlds.join(', ')}; connect again with --world to choose.`,
        ),
      );
      return;
    }
    this.admitting = true;
    this.connection?.send({ t: 'admit', world, nickname: this.nickname! });
  }

  private change(state: ClientState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
