import type { Level } from '@overstory/sprout/lang';
import type { ServerMessage } from '@overstory/sprout/core';

// What the client shows (docs/design/sprout-server.md, The protocol):
// every message the server sends folded into one state,
// with no terminal in it. The transcript is the world's prose by its kind,
// what visitors said to each other styled apart, and the host's records at
// the levels this client shows; the status line is the place and its
// exits; what can be typed now is completed from the lines the server
// offers. Normal play shows prose and errors, and `/log` shows more.

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

/** The status line: where the visitor stands, and the ways out. */
export interface Status {
  readonly place: string;
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
}

export const EMPTY: ClientState = {
  lines: [],
  status: null,
  offered: [],
  world: null,
  nickname: null,
  worlds: [],
  closed: null,
};

/** `state` with `message`, from the server, folded in. */
export function received(state: ClientState, message: ServerMessage): ClientState {
  switch (message.t) {
    case 'welcome':
      return { ...state, worlds: message.worlds.map((one) => one.world) };
    case 'admitted':
      return {
        ...add(state, 'client', `You are in ${message.world} as ${message.nickname}.`),
        world: message.world,
        nickname: message.nickname,
      };
    case 'refused':
      return add(state, 'refused', message.text);
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
          exits: message.exits.map((exit) => exit.direction ?? exit.label),
        },
      };
    case 'offered':
      return { ...state, offered: message.lines };
    case 'record':
      return {
        ...state,
        lines: [...state.lines, { kind: 'record', text: message.text, level: message.level }],
      };
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
