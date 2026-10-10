// Builds and signs the index of published worlds the Playdate app's download screen reads.
//
//   node scripts/publish-index.mjs <folder> --base-url <url> [--key <file>] [--out <folder>]
//   node scripts/publish-index.mjs --generate-key <path-prefix>
//
// <folder> holds the `.sproutworld` cartridges (and their `.assets` folders) that `sprout pack`
// wrote. The index lists each with its title, author, version, size, bundle hash, SHA-256 and the
// address <url> followed by its file name, and is signed over the canonical text of that list.
// `index.json` is written into <folder>, or into --out with the cartridges copied beside it, ready
// to upload so that <url>index.json is the address the app is configured with.
//
// The private key is a file of 64 hexadecimal digits, named by --key or by the environment variable
// SPROUT_INDEX_KEY; it is never read from the repository and never printed. --generate-key writes
// <prefix>.key (readable by its owner only) and <prefix>.pub, and refuses to replace either. The
// app is built with the public half (README.md, Playdate > Shipped worlds and downloads).

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex, generateKeyPair, privateKeyOf, readKeyFile } from './index-signing.mjs';

const USAGE =
  'Usage: node scripts/publish-index.mjs <folder> --base-url <url> [--key <file>] [--out <folder>]\n' +
  '       node scripts/publish-index.mjs --generate-key <path-prefix>';

/** The value after `flag` in `args`, or undefined. */
function option(args, flag) {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

/**
 * Runs the command. `say` receives each line of output; the return is the exit code. Throws nothing
 * that a person could fix: it says what to do and returns 1.
 */
export function main(args, env, say) {
  try {
    const prefix = option(args, '--generate-key');
    if (args.includes('--generate-key')) {
      if (prefix === undefined) return fail(say, 'Say where to write the key pair.');
      const { seed, publicKey } = generateKeyPair();
      for (const path of [`${prefix}.key`, `${prefix}.pub`]) {
        if (existsSync(path)) return fail(say, `${path} already exists; it is not replaced.`);
      }
      writeFileSync(`${prefix}.key`, `${seed}\n`, { mode: 0o600 });
      writeFileSync(`${prefix}.pub`, `${publicKey}\n`);
      say(`wrote ${prefix}.key (keep it secret and out of the repository) and ${prefix}.pub (the app is built with it)`);
      return 0;
    }
    const folder = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
    const baseUrl = option(args, '--base-url');
    const keyPath = option(args, '--key') ?? env.SPROUT_INDEX_KEY;
    if (folder === undefined || baseUrl === undefined) return fail(say, 'Give a folder of cartridges and --base-url.');
    if (keyPath === undefined) {
      return fail(say, 'Give the private key file with --key, or in the environment variable SPROUT_INDEX_KEY.');
    }
    if (!/^https?:\/\//.test(baseUrl)) return fail(say, `--base-url ${baseUrl} should begin with http:// or https://.`);
    const index = buildIndex(resolve(folder), baseUrl, privateKeyOf(readKeyFile(keyPath)));
    const out = resolve(option(args, '--out') ?? folder);
    if (out !== resolve(folder)) {
      mkdirSync(out, { recursive: true });
      for (const file of readdirSync(folder)) {
        if (file.endsWith('.sproutworld') || file.endsWith('.sproutworld.assets')) {
          cpSync(join(folder, file), join(out, file), { recursive: true });
        }
      }
    }
    writeFileSync(join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    say(`signed ${index.worlds.length} world${index.worlds.length === 1 ? '' : 's'} into ${join(out, 'index.json')}`);
    return 0;
  } catch (err) {
    return fail(say, err.message);
  }
}

function fail(say, words) {
  say(`${words}\n${USAGE}`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2), process.env, (line) => console.log(line)));
}
