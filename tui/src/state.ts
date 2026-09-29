import type { Level } from '@overstory/sprout/lang';
import type { ServerMessage } from '@overstory/sprout/core';

// What the client shows (docs/design/sprout-server.md, The protocol):
// every message the server sends folded into one state,
// with no terminal in it. The transcript is the world's prose by its kind,
// what visitors said to each other styled apart, and the host's records at
// the levels this client shows; the status is the place, what else it
// holds and its exits; what can be typed now is completed from the lines
// the server offers. Normal play shows prose and errors, and `/log` shows
// more. The connection's health is open, lost, or troubled for a minute
// after an error reaches the client: an error record, or a frame refused
// before a world was asked for or as a frame. A world's own refusals are
// prose, and a nickname refused is the visitor's to fix, so neither counts.

/** How long an error keeps the connection's health troubled, in milliseconds. */
export const TROUBLED_FOR = 60_000;

/** One line of the transcript, by what it is, which is how it is styled. */
export interface Line {
  /** An effect's kind, `chat` for a visitor's words, `record` for the host's, `client` for the client's own, `typed` for what was sent. */
  readonly kind:
    | 'said'
    | 'told'
    | 'refused'
    | 'described'
    | 'notice'
    | 'extension'
    | 'chat'
    | 'record'
    | 'client'
    | 'typed';
  readonly text: string;
  /** A record's level; prose for everything else. */
  readonly level: Level;
}

/** Where the visitor stands, what else is there, and the ways out. */
export interface Status {
  readonly place: string;
  readonly here: readonly string[];
  readonly exits: readonly string[];
}

/** Everything the client shows. */
export interface ClientState {
  readonly lines: readonly Line[];
  readonly status: Status | null;
  /** The lines the visitor could type now, for completion. */
  readonly offered: readonly string[];
  /** The world admitted to, and under what nickname; null before admission and after leaving. */
  readonly world: string | null;
  readonly nickname: string | null;
  /** The worlds the server serves. */
  readonly worlds: readonly string[];
  /** Why the connection closed; null while it is open. */
  readonly closed: string | null;
  /** When the last error reached the client, in the client's milliseconds; null for none. */
  readonly troubledAt: number | null;
}

/** What the header shows of the connection. */
export type Health = 'connecting' | 'open' | 'troubled' | 'lost';

export const EMPTY: ClientState = {
  lines: [],
  status: null,
  offered: [],
  world: null,
  nickname: null,
  worlds: [],
  closed: null,
  troubledAt: null,
};

/** `state` with `message`, from the server, folded in, `now` the client's time in milliseconds. */
export function received(state: ClientState, message: ServerMessage, now: number): ClientState {
  switch (message.t) {
    case 'welcome':
      return { ...state, worlds: message.worlds.map((one) => one.world) };
    case 'admitted':
      return {
        ...add(state, 'client', `You are in ${message.world} as ${message.nickname}.`),
        world: message.world,
        nickname: message.nickname,
      };
    case 'refused': {
      const refused = add(state, 'refused', message.text);
      return message.stage === 'admit' ? refused : troubled(refused, now);
    }
    case 'effects':
      return message.effects.reduce(
        (now, effect) =>
          effect.as === 'words'
            ? add(now, effect.kind, effect.paragraphs.join('\n'))
            : add(now, 'extension', `[${effect.recorded.extension} ${effect.recorded.statement}]`),
        state,
      );
    case 'view':
      return state;
    case 'status':
      return {
        ...state,
        status: {
          place: message.place,
          here: message.here.map((one) => one.name),
          exits: message.exits.map((exit) => exit.direction ?? exit.label),
        },
      };
    case 'offered':
      return { ...state, offered: message.lines };
    case 'record': {
      const recorded: ClientState = {
        ...state,
        lines: [...state.lines, { kind: 'record', text: message.text, level: message.level }],
      };
      return message.level === 'error' ? troubled(recorded, now) : recorded;
    }
    case 'chat':
      return add(state, 'chat', `${message.from}: ${message.line}`);
    case 'bye':
      return { ...add(state, 'client', message.text), world: null, closed: message.reason };
  }
}

/** `state` with a line of `kind` said, at prose. */
export function add(state: ClientState, kind: Line['kind'], text: string): ClientState {
  return { ...state, lines: [...state.lines, { kind, text, level: 'prose' }] };
}

/** `state` with an error reaching the client at `now`. */
export function troubled(state: ClientState, now: number): ClientState {
  return { ...state, troubledAt: now };
}

/** The connection's health at `now`: lost once closed, troubled within a minute of an error, open once in a world. */
export function healthOf(state: ClientState, now: number): Health {
  if (state.closed !== null) return 'lost';
  if (state.troubledAt !== null && now - state.troubledAt < TROUBLED_FOR) return 'troubled';
  return state.world === null ? 'connecting' : 'open';
}

/** The lines shown at `shown`, the levels this client shows: prose always, a record at its level. */
export function visible(lines: readonly Line[], shown: ReadonlySet<Level>): Line[] {
  return lines.filter((line) => line.kind !== 'record' || shown.has(line.level));
}

/** The status line, as words: the place, then its ways out. */
export function statusWords(status: Status | null): string {
  if (status === null) return '';
  return status.exits.length === 0
    ? status.place
    : `${status.place} — exits: ${status.exits.join(', ')}`;
}
