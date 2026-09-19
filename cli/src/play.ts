import { createInterface } from 'node:readline';

import { readArchive, stateDirOf } from './archive.js';
import { checkArchive, formatCheck } from './check.js';
import { openSession } from './session.js';
import { openStore, type StoreKind } from './store.js';
import { renderTurn } from './transcript.js';

// `sprout play` (the split proposal §6): the archive checked, loaded and
// walked at a prompt — the transcript, ↑ history, Tab completion from
// core's `complete`, `help` from the room's own grammar. Every typed
// line is a `say` turn; `quit` (or the end of input) is a `leave`.

export interface PlayOptions {
  archive: string;
  as: string;
  fresh?: boolean;
  store: StoreKind;
  /** Where PGlite keeps the state; `.sprout/` beside the folder by default. */
  stateDir?: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Whether the prompt is a terminal: history and completion need one. */
  terminal?: boolean;
  now?: () => Date;
}

export const QUIT = new Set(['quit', 'exit', 'q']);

export async function play(opts: PlayOptions): Promise<number> {
  const now = opts.now ?? (() => new Date());
  const out = (lines: string[]) => {
    for (const l of lines) opts.output.write(`${l}\n`);
  };
  const archive = readArchive(opts.archive);
  const check = checkArchive(archive);
  if (!check.ok) {
    opts.output.write(formatCheck(check));
    return 1;
  }
  if (!check.program.entry) {
    opts.output.write('No door here: sprout.json names no entry room.\n');
    return 1;
  }
  const opened = await openStore(opts.store, opts.stateDir ?? stateDirOf(archive));
  try {
    const { runtime, microworldId, absent, reloaded } = await openSession(archive, opened.store, {
      fresh: opts.fresh,
      now: now(),
    });
    if (reloaded) out([`(loaded ${archive.files.length} files as ${microworldId})`]);
    for (const a of absent) out([`(left out — ${a})`]);
    const actor = { id: opts.as, name: opts.as };
    const turn = async (input: Parameters<typeof runtime.turn>[0]['input']) =>
      runtime.turn({ microworldId, actor, input, now: now() });
    out(renderTurn(await turn({ kind: 'enter' })));

    const rl = createInterface({
      input: opts.input,
      output: opts.terminal ? opts.output : undefined,
      terminal: opts.terminal ?? false,
      prompt: '> ',
      completer: (line: string, cb: (err: null, result: [string[], string]) => void) => {
        runtime
          .complete({ microworldId, actor, prefix: line, now: now() })
          .then(({ completions }) => cb(null, [completions, line]))
          .catch(() => cb(null, [[], line]));
      },
    });
    let left = false;
    let closed = false;
    const leave = async () => {
      if (left) return;
      left = true;
      await turn({ kind: 'leave' });
    };
    const prompt = () => {
      if (!closed) rl.prompt();
    };
    await new Promise<void>((resolve) => {
      // One line at a time, in order: the next prompt waits for this turn's
      // answer; a piped script has usually ended by the time the first is
      // answered, so nothing here touches readline once it has closed.
      let chain = Promise.resolve();
      const answer = async (line: string) => {
        const text = line.trim();
        if (text === '' || left) return;
        if (!opts.terminal) out([`> ${text}`]);
        if (QUIT.has(text.toLowerCase())) {
          await leave();
          if (!closed) rl.close();
          return;
        }
        out(renderTurn(await turn({ kind: 'say', text })));
        prompt();
      };
      const quietly = (fn: () => Promise<void>) => () =>
        fn().catch((err) => out([`sprout: ${err instanceof Error ? err.message : String(err)}`]));
      rl.on('line', (line) => {
        chain = chain.then(quietly(() => answer(line)));
      });
      rl.on('close', () => {
        closed = true;
        chain = chain.then(quietly(leave)).then(resolve);
      });
      prompt();
    });
    return 0;
  } finally {
    await opened.close();
  }
}
