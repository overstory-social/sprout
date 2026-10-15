import { createInterface } from 'node:readline';

import type { Session } from './session.js';
import { statusWords, visible } from './state.js';

// The client without a screen (`--plain`): for a pipe, a script or a screen
// reader. Each line of the transcript is written once, as it arrives, the
// status line after it wherever it changed, and each line read from the
// input is typed. The input ending is `/quit`; either way it ends once
// the server has said goodbye or the connection has closed.

/** Run `session` as lines in and lines out; resolves once it ends. */
export function playPlain(
  session: Session,
  input: NodeJS.ReadableStream,
  output: { write(text: string): unknown },
): Promise<void> {
  let written = 0;
  let status = '';
  const show = () => {
    const lines = session.state.lines;
    for (; written < lines.length; written++) {
      const line = lines[written]!;
      if (visible([line], session.shown).length > 0) output.write(`${line.text}\n`);
    }
    const now = statusWords(session.state.status);
    if (now !== '' && now !== status) {
      status = now;
      output.write(`[${now}]\n`);
    }
  };
  const stop = session.onChange(show);
  show();
  const reader = createInterface({ input, terminal: false });
  return new Promise((resolve) => {
    let typing: Promise<unknown> = Promise.resolve();
    let quit = false;
    reader.on('line', (line) => {
      typing = typing.then(async () => {
        if (quit) return;
        if (!(await session.type(line))) {
          quit = true;
          reader.close();
        }
      });
    });
    reader.on('close', () => {
      void typing.then(async () => {
        // The input ending is `/quit`, after what was typed before it is answered.
        if (!quit) {
          await session.idle();
          await session.type('/quit');
        }
        // The client ends once the server's goodbye is shown, so the visitor leaves in words.
        await session.gone();
        stop();
        resolve();
      });
    });
  });
}
