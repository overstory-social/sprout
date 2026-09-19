#!/usr/bin/env node
// The `sprout` command. Built by `tsc` into dist/; a bundle (with PGlite's
// WASM beside it) is a later release's call.
import { main } from '../dist/cli.js';

// `sprout play … | head` closes the pipe early: that is the reader's
// choice, not an error.
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2));
