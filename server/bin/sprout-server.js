#!/usr/bin/env node
// The `sprout-server` command. Built by `tsc` into dist/.
import { main } from '../dist/main.js';

const stopped = new Promise((resolve) => {
  process.once('SIGINT', resolve);
  process.once('SIGTERM', resolve);
});
main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, stopped }).then((code) => {
  process.exit(code);
});
