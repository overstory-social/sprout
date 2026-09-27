// The grammars as VS Code reads them: `vscode-textmate` over the files in
// syntaxes/, with `vscode-oniguruma` for their regular expressions, and
// every `.sprout` and `.prose` file of the corpus to read with them.

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

const here = dirname(fileURLToPath(import.meta.url));
export const SYNTAXES = join(here, '..', '..', 'syntaxes');
const CORPUS = join(here, '..', '..', '..', '..', 'corpus');

const FILES: Readonly<Record<string, string>> = {
  'source.sprout': 'sprout.tmLanguage.json',
  'source.sprout-prose': 'sprout-prose.tmLanguage.json',
};

/** One token of a line: its text and the scopes it is coloured by, outermost first. */
export interface Token {
  readonly text: string;
  readonly scopes: readonly string[];
}

let registry: Promise<textmate.Registry> | null = null;

function load(): Promise<textmate.Registry> {
  registry ??= (async () => {
    const wasm = readFileSync(
      createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'),
    );
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    return new textmate.Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
        createOnigString: (s) => new oniguruma.OnigString(s),
      }),
      loadGrammar: async (scope) => {
        const file = FILES[scope];
        if (file === undefined) return null;
        const path = join(SYNTAXES, file);
        return textmate.parseRawGrammar(readFileSync(path, 'utf8'), path);
      },
    });
  })();
  return registry;
}

/** `text` read line by line with the grammar of `scope`, each line its tokens. */
export async function tokenise(scope: string, text: string): Promise<Token[][]> {
  const grammar = await (await load()).loadGrammar(scope);
  if (grammar === null) throw new Error(`no grammar for ${scope}`);
  let stack = textmate.INITIAL;
  return text.split('\n').map((line) => {
    const read = grammar.tokenizeLine(line, stack);
    stack = read.ruleStack;
    return read.tokens.map((t) => ({
      text: line.slice(t.startIndex, t.endIndex),
      scopes: t.scopes,
    }));
  });
}

/** Every `.sprout` and `.prose` file under corpus/good and corpus/bad, relative to corpus/. */
export function corpusFiles(): string[] {
  return readdirSync(CORPUS, { recursive: true, encoding: 'utf8' })
    .filter((f) => /^(good|bad)\//.test(f) && /\.(sprout|prose)$/.test(f))
    .sort();
}

/** A corpus file's text. */
export function corpusText(file: string): string {
  return readFileSync(join(CORPUS, file), 'utf8');
}

/** The grammar's scope for a file, by its ending. */
export function scopeOf(file: string): string {
  return file.endsWith('.prose') ? 'source.sprout-prose' : 'source.sprout';
}

/**
 * The scopes of the token reading `token`, less the spaces around it, on the first line of corpus `file` that
 * holds `line`, read with everything before it in the file, so a line
 * inside a passage or a comment is read as being inside it.
 */
export async function scopesAt(
  file: string,
  line: string,
  token: string,
): Promise<readonly string[]> {
  const lines = await tokenise(scopeOf(file), corpusText(file));
  const at = corpusText(file)
    .split('\n')
    .findIndex((l) => l.includes(line));
  if (at < 0) throw new Error(`${file} has no line holding ${line}`);
  const start = corpusText(file).split('\n')[at]!.indexOf(line);
  let offset = 0;
  for (const t of lines[at]!) {
    if (offset + t.text.length > start && t.text.trim() === token) return t.scopes;
    offset += t.text.length;
  }
  throw new Error(
    `${file}:${at + 1} has no token ${JSON.stringify(token)} in ${JSON.stringify(line)}`,
  );
}
