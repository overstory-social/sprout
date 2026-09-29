import { LEVELS, type Level } from '@overstory/sprout/lang';

// What the visitor types (docs/design/sprout-server.md): a line for the
// world, or one of the client's own commands, each written after a `/`:
// `/say` to speak to the others here, `/log` to show a level of the host's
// records or hide it, `/reconnect`, `/help` and `/quit`. Up and down walk
// the lines typed before; tab completes from what the world offers now,
// and a `/` from the client's commands.

/** A client command: its name, and what it is for, as its popup shows it. */
export interface ClientCommand {
  readonly name: string;
  readonly usage: string;
  readonly does: string;
}

export const CLIENT_COMMANDS: readonly ClientCommand[] = [
  { name: 'say', usage: '/say words', does: 'say something to everyone standing with you' },
  {
    name: 'log',
    usage: '/log level',
    does: 'show or hide the host’s records at a level: warning, info, debug',
  },
  {
    name: 'reconnect',
    usage: '/reconnect',
    does: 'connect again, and come back as the visitor you were',
  },
  { name: 'help', usage: '/help', does: 'list the client’s commands' },
  { name: 'quit', usage: '/quit', does: 'leave the world and close the client' },
];

/** A typed line, read. */
export type Typed =
  | { readonly world: string }
  | { readonly say: string }
  | { readonly log: Exclude<Level, 'prose' | 'error'> }
  | { readonly client: 'reconnect' | 'help' | 'quit' }
  | { readonly nothing: true }
  | { readonly unknown: string };

/** The levels `/log` shows and hides; prose and errors are always shown. */
export const TOGGLED: readonly Exclude<Level, 'prose' | 'error'>[] = LEVELS.filter(
  (level): level is Exclude<Level, 'prose' | 'error'> => level !== 'prose' && level !== 'error',
);

/** What `line` is: a line for the world, a client command, or words saying what is wrong with it. */
export function typedOf(line: string): Typed {
  const trimmed = line.trim();
  if (trimmed === '') return { nothing: true };
  if (!trimmed.startsWith('/')) return { world: trimmed };
  const [name = '', ...rest] = trimmed.slice(1).split(/\s+/);
  const argument = rest.join(' ');
  switch (name) {
    case 'say':
      return argument === ''
        ? { unknown: 'Write what to say after it: /say hello' }
        : { say: argument };
    case 'log': {
      const level = TOGGLED.find((one) => one === argument);
      return level === undefined
        ? { unknown: `\`/log\` takes a level: ${TOGGLED.join(', ')}.` }
        : { log: level };
    }
    case 'reconnect':
    case 'help':
    case 'quit':
      return { client: name };
    default:
      return { unknown: `There is no \`/${name}\`; \`/help\` lists the client’s commands.` };
  }
}

/** What `typed` could be completed to: the client's commands after a `/`, else the lines the world offers that begin with it. */
export function completions(typed: string, offered: readonly string[]): string[] {
  if (typed.startsWith('/')) {
    return CLIENT_COMMANDS.map((one) => `/${one.name}`).filter((one) => one.startsWith(typed));
  }
  const lower = typed.toLowerCase();
  if (lower.trim() === '') return [];
  return [...new Set(offered.filter((one) => one.toLowerCase().startsWith(lower)))];
}

/** The lines typed before, walked with up and down: `up` the one before, `down` back, and the line being written kept. */
export class History {
  private readonly typed: string[] = [];
  /** Where the walk stands: the number of lines typed, where nothing earlier is shown. */
  private at = 0;
  private draft = '';

  /** Keep `line`, and stand after it. */
  push(line: string): void {
    if (line.trim() !== '' && this.typed.at(-1) !== line) this.typed.push(line);
    this.at = this.typed.length;
    this.draft = '';
  }

  /** The line before the one shown, `current` kept as the draft where the walk starts. */
  up(current: string): string {
    if (this.at === this.typed.length) this.draft = current;
    if (this.at > 0) this.at -= 1;
    return this.typed[this.at] ?? current;
  }

  /** The line after the one shown, and the draft past the last. */
  down(): string {
    if (this.at < this.typed.length) this.at += 1;
    return this.at === this.typed.length ? this.draft : this.typed[this.at]!;
  }
}
