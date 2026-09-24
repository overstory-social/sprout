import { describe, expect, it } from 'vitest';

import { Draws } from '../runtime/draws.js';
import { boundObject, ECHO, PRESS, proseTurn } from '../fixtures/prose.js';
import { LineDraws } from './line-draws.js';
import { renderFor, type Line } from './speech.js';

/** The echo's `name`, said to Marta, as one line. */
function lineOf(turn: ReturnType<typeof proseTurn>, name: string): Line {
  const passage = turn.draft.instance(ECHO)!.kind.passages.get(name)!;
  return { by: ECHO, said: { passage }, bindings: new Map([['actor', boundObject(turn.marta)]]) };
}

describe('a line draws once, for every reader', () => {
  it('reads the same choice to each reader, naming each as they read it', () => {
    for (let seed = 0; seed < 40; seed++) {
      const turn = proseTurn(undefined, seed);
      const line = lineOf(turn, 'toss');
      const [toMarta] = renderFor(line, turn.marta, turn.context);
      const [toPress] = renderFor(line, PRESS, turn.context);
      expect(toPress, String(seed)).toBe(toMarta!.replace(/you\.$/, 'Marta.'));
    }
  });

  it('draws afresh for another line, from the one stream', () => {
    const draws = new Draws(21);
    const lines = new LineDraws(draws);
    const turn = proseTurn();
    const one = lines.of(lineOf(turn, 'call'));
    const two = lines.of(lineOf(turn, 'call'));
    const expected = new Draws(21);
    expect([one.below(3), two.below(3)]).toEqual([expected.below(3), expected.below(3)]);
    expect(draws.drawn).toBe(2);
  });

  it('reads back what a line drew, in order, without drawing again', () => {
    const draws = new Draws(4);
    const lines = new LineDraws(draws);
    const line = lineOf(proseTurn(), 'toss');
    const first = lines.of(line);
    const drawn = [first.below(2), first.below(3), first.below(5)];
    const again = lines.of(line);
    expect([again.below(2), again.below(3), again.below(5)]).toEqual(drawn);
    expect(draws.drawn).toBe(3);
  });

  it('is the engine’s defect where a reader asks what the first did not', () => {
    const lines = new LineDraws(new Draws(4));
    const line = lineOf(proseTurn(), 'toss');
    lines.of(line).below(2);
    expect(() => lines.of(line).below(3)).toThrow(
      /drew below 3 for one reader where it drew below 2/,
    );
  });
});
