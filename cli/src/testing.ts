import { PassThrough, Readable } from 'node:stream';

import type { Io } from './cli.js';

// Spec support (never imported by a command): an Io whose output is
// captured, and a stdin that plays a script one line at a time.

export interface CapturedIo extends Io {
  out(): string;
  err(): string;
}

/** An Io with `lines` on stdin and both outputs captured. */
export function captured(lines: readonly string[] = []): CapturedIo {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (c: Buffer | string) => (out += c.toString()));
  stderr.on('data', (c: Buffer | string) => (err += c.toString()));
  return {
    stdin: Readable.from(lines.map((l) => `${l}\n`)),
    stdout,
    stderr,
    terminal: false,
    out: () => out,
    err: () => err,
  };
}
