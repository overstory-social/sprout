import { PassThrough } from 'node:stream';

import type { Io } from './cli.js';

// Spec support, never imported by a command: an Io whose output is captured.

export interface CapturedIo extends Io {
  out(): string;
  err(): string;
}

export function captured(): CapturedIo {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (c: Buffer | string) => (out += c.toString()));
  stderr.on('data', (c: Buffer | string) => (err += c.toString()));
  return { stdout, stderr, out: () => out, err: () => err };
}
