import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { BudgetExhausted } from '../runtime/budget.js';
import { engineLine } from '../runtime/engine-lines.js';
import { parseProse } from '../syntax/parse.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import {
  boundObject,
  BRASS_KEY,
  CRATE,
  passageFor,
  PRESS,
  proseTurn,
  YARD,
} from '../fixtures/prose.js';
import { renderFor } from './speech.js';

/** Words in quotes, as a `say` gives them. */
function quoted(text: string) {
  return {
    text,
    prose: parseProse(new SourceFile('q.sprout', text), new Diagnostics()),
    library: 'mill',
  };
}

describe('a line said is rendered for each reader', () => {
  it('renders a passage as the speaker’s kind has it, with the names in scope where it was said', () => {
    const turn = proseTurn();
    expect(
      passageFor(turn, PRESS, 'inked', turn.marta, {
        actor: boundObject(turn.marta),
        tools: { binds: 'set', ids: [BRASS_KEY] },
      }),
    ).toEqual(['You inks a press with a brass key.']);
  });

  it('renders words in quotes as a one-line passage, capitalised, and differently to each reader', () => {
    const turn = proseTurn();
    const line = {
      by: PRESS,
      said: quoted('{actor} leans on {self}. \\{brace}'),
      bindings: new Map([['actor', boundObject(turn.marta)]]),
    };
    // The verb's agreement is the author's: the line is written for bystanders.
    expect(renderFor(line, turn.marta, turn.context)).toEqual(['You leans on a press. {brace}']);
    expect(renderFor(line, BRASS_KEY, turn.context)).toEqual(['Marta leans on a press. {brace}']);
    expect(renderFor(line, PRESS, turn.context)).toEqual(['Marta leans on you. {brace}']);
  });

  it('renders the engine’s fixed words with what it binds', () => {
    const turn = proseTurn();
    const line = {
      by: YARD,
      said: engineLine('{item} cannot stand in {to}.'),
      bindings: new Map([
        ['item', boundObject(turn.marta)],
        ['to', boundObject(CRATE)],
      ]),
    };
    expect(renderFor(line, turn.marta, turn.context)).toEqual(['You cannot stand in the crate.']);
  });

  it('renders nothing of a passage that is absent', () => {
    const turn = proseTurn();
    const line = { by: PRESS, said: { absent: 'gone' }, bindings: new Map() };
    expect(renderFor(line, turn.marta, turn.context)).toEqual([]);
    expect(turn.context.budget.spentOutput(turn.marta)).toBe(0);
  });
});

describe('what is rendered is charged to its reader', () => {
  it('counts the characters each reader is told, apart from every other reader', () => {
    const turn = proseTurn();
    const line = { by: PRESS, said: quoted('Clunk.'), bindings: new Map() };
    renderFor(line, turn.marta, turn.context);
    renderFor(line, turn.marta, turn.context);
    renderFor(line, BRASS_KEY, turn.context);
    expect(turn.context.budget.spentOutput(turn.marta)).toBe(12);
    expect(turn.context.budget.spentOutput(BRASS_KEY)).toBe(6);
  });

  it('faults a turn that tells one reader more than the host allows', () => {
    const turn = proseTurn({ ...DEFAULT_LIMITS.budgets, output: 10 });
    const line = { by: PRESS, said: quoted('Clunk.'), bindings: new Map() };
    renderFor(line, turn.marta, turn.context);
    expect(() => renderFor(line, turn.marta, turn.context)).toThrow(BudgetExhausted);
    expect(() => renderFor(line, BRASS_KEY, turn.context)).not.toThrow();
  });

  it('runs a named passage one passage deep, and comes back up however it ends', () => {
    const turn = proseTurn({ ...DEFAULT_LIMITS.budgets, passageDepth: 1 });
    expect(passageFor(turn, PRESS, 'mood', turn.marta)).toHaveLength(1);
    expect(() => passageFor(turn, CRATE, 'listing', turn.marta)).toThrow(BudgetExhausted);
    expect(turn.context.budget.passageDepth).toBe(0);
  });
});
