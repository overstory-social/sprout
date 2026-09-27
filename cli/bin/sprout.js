#!/usr/bin/env node
// The `sprout` command. Built by `tsc` into dist/.
import { main } from '../dist/cli.js';

// `sprout check … | head` closes the pipe early: the reader's choice, not an error.
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const result = main(process.argv.slice(2));
if (result instanceof Promise) {
  result.then((code) => {
    process.exitCode = code;
  });
} else {
  process.exitCode = result;
}
