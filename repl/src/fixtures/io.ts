import { PassThrough } from 'node:stream';

import type { Io } from '../interactive.js';

// Spec support for the REPL and the CLI, never imported by a command: an
// `Io` whose output is captured.

export interface CapturedIo extends Io {
  out(): string;
  err(): string;
}

/** An `Io` whose output is captured; `input` is what `play` with no script reads as its typed lines. */
export function captured(input = ''): CapturedIo {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  stdin.end(input);
  let out = '';
  let err = '';
  stdout.on('data', (c: Buffer | string) => (out += c.toString()));
  stderr.on('data', (c: Buffer | string) => (err += c.toString()));
  return { stdout, stderr, stdin, out: () => out, err: () => err };
}
