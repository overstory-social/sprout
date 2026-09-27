import { describe, expect, it } from 'vitest';
import { corpusFiles, scopeOf, tokenise } from './tokenise.ts';

describe('the tokenising fixture', () => {
  it('finds both kinds of file in both halves of the corpus', () => {
    const files = corpusFiles();
    for (const half of ['good/', 'bad/']) {
      for (const ending of ['.sprout', '.prose']) {
        expect(files.some((f) => f.startsWith(half) && f.endsWith(ending))).toBe(true);
      }
    }
  });

  it('gives every character of a line to exactly one token, with the file’s scope outermost', async () => {
    const line = 'kind Key { :wear 0 }';
    const [tokens] = await tokenise(scopeOf('key.sprout'), line);
    expect(tokens!.map((t) => t.text).join('')).toBe(line);
    for (const t of tokens!) expect(t.scopes[0]).toBe('source.sprout');
  });
});
