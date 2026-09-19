#!/usr/bin/env node
// The `sprout` command. Built by `tsc` into dist/; stage 4 decides
// whether a bundle replaces this shim (PGlite's WASM must sit beside it).
import { main } from '../dist/cli.js';

process.exitCode = await main(process.argv.slice(2));
