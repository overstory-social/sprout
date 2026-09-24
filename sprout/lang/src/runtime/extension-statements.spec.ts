import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';
import { mediaWith } from '../fixtures/extensions.js';
import {
  gallery,
  galleryCatalogue,
  galleryHost,
  HALL,
  MARTA,
  INES,
  PAINTING,
  typed,
} from '../fixtures/gallery.js';
import { commandTurn, type CommandTurn } from './command.js';
import type { Effect } from './effects.js';
import type { Catalogue } from './catalogue.js';
import type { Plain } from '../declare/extensions.js';
import type { ExtensionStatement } from '../syntax/ast-extensions.js';
import { SourceFile } from '../source/source.js';
import { Budget } from './budget.js';
import { boundObject, type Frame } from './evaluate.js';
import { recordOf } from './extension-statements.js';
import { readerOf } from './state.js';

/** A command Marta types in the gallery under `catalogue`, and what came of it. */
function run(
  text: string,
  catalogue: Catalogue = galleryCatalogue(),
  budgets = DEFAULT_LIMITS.budgets,
): CommandTurn {
  return commandTurn(
    gallery(catalogue, [MARTA, INES]),
    galleryHost(catalogue, budgets),
    typed(MARTA, text),
  );
}

/** Each effect as its kind, its reader's visit, its words and, for an extension's, what it recorded. */
function shown(effects: readonly Effect[]) {
  return effects.map((effect) =>
    effect.kind === 'extension'
      ? [
          effect.kind,
          effect.visit,
          effect.paragraphs,
          `${effect.extension}.${effect.statement}`,
          effect.payload,
        ]
      : [effect.kind, effect.visit, effect.paragraphs],
  );
}

describe('an extension’s statement, run', () => {
  it('records its effect among what the body says, in body order, to whom the body says it', () => {
    const turn = run('view painting');
    expect(turn.committed).toBe(true);
    expect(shown(turn.effects)).toEqual([
      [
        'extension',
        MARTA,
        ['[A picture: a cat]'],
        'media.show',
        { src: 'cat.png', caption: 'a cat', self: PAINTING },
      ],
      ['said', MARTA, ['You look closely.']],
    ]);
  });

  it('is what the actor is told, so a `do` that records and says nothing else is not answered `nothing_happens`', () => {
    const turn = run('hear cat');
    expect(shown(turn.effects)).toEqual([
      ['extension', MARTA, ['[A sound plays.]'], 'media.play', { src: 'purr.ogg' }],
    ]);
  });

  it('records to the people in the place, as a plain `tell` reaches them, from a handler', () => {
    const turn = run('admire hall');
    expect(shown(turn.effects)).toEqual([
      ['said', MARTA, ['You admire the hall.']],
      [
        'extension',
        MARTA,
        ['[A picture: the hall, admired]'],
        'media.show',
        { src: 'hall.png', caption: 'the hall, admired', self: HALL },
      ],
      [
        'extension',
        INES,
        ['[A picture: the hall, admired]'],
        'media.show',
        { src: 'hall.png', caption: 'the hall, admired', self: HALL },
      ],
    ]);
  });

  it('records after the description it stands in, to the one looking', () => {
    const turn = run('look');
    expect(shown(turn.effects)).toEqual([
      ['described', MARTA, ['A bright hall.']],
      [
        'extension',
        MARTA,
        ['[A picture: the hall]'],
        'media.show',
        { src: 'hall.png', caption: 'the hall', self: HALL },
      ],
    ]);
  });

  it('hands `run` its arguments and who ran it frozen, so the extension cannot change them', () => {
    let seen: { arguments: readonly Plain[]; self: string; actor: string | null } | null = null;
    const catalogue = galleryCatalogue([
      mediaWith({
        run: (frame) => {
          seen = frame;
          return { src: 'x', caption: 'y', self: frame.self };
        },
      }),
    ]);
    run('view painting', catalogue);
    expect(seen).not.toBeNull();
    const frame = seen!;
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.arguments)).toBe(true);
    expect(Object.isFrozen(frame.arguments[0])).toBe(true);
    expect(frame.arguments).toEqual([{ src: 'cat.png' }, 'a cat']);
    expect(frame.self).toBe(PAINTING);
    expect(frame.actor).toMatch(/^gallery#/);
  });
});

describe('an extension that misbehaves', () => {
  const faulted = (turn: CommandTurn) => {
    if (turn.committed) throw new Error('expected the turn to fault');
    return turn;
  };

  it('faults the turn naming the extension where `run` throws, and the actor is told the world’s `fault`', () => {
    const turn = faulted(
      run(
        'view painting',
        galleryCatalogue([
          mediaWith({
            run: () => {
              throw new Error('no screen');
            },
          }),
        ]),
      ),
    );
    expect(turn.fault).toMatchObject({
      name: 'ExtensionFault',
      extension: 'media',
      object: PAINTING,
      engine: false,
    });
    expect(turn.fault.detail).toContain('no screen');
    expect(shown(turn.effects)).toEqual([
      ['notice', MARTA, ['Something in this world has gone wrong, and nothing has changed.']],
    ]);
  });

  it('faults where what `run` gives is not plain, or is refused by the statement’s effect schema', () => {
    const notPlain = faulted(
      run(
        'view painting',
        galleryCatalogue([mediaWith({ run: () => ({ when: new Date(0) }) as unknown as Plain })]),
      ),
    );
    expect(notPlain.fault.detail).toContain('what is not plain');
    const refused = faulted(
      run('view painting', galleryCatalogue([mediaWith({ run: () => ({ src: 1 }) })])),
    );
    expect(refused.fault).toMatchObject({ extension: 'media' });
    expect(refused.fault.detail).toContain('its schema refuses');
  });

  it('faults where it gives no transcript line, which a text-only client would read as silence', () => {
    for (const transcript of [() => '', () => '   ', () => 7 as unknown as string]) {
      const turn = faulted(run('view painting', galleryCatalogue([mediaWith({ transcript })])));
      expect(turn.fault.detail).toContain('no transcript line');
    }
  });

  it('faults past the host’s cap on the effects one turn records, and not where the host sets none', () => {
    const capped = limitsFrom({ budgets: { extensionEffects: 1 } }).budgets;
    expect(run('view painting', galleryCatalogue(), capped).committed).toBe(true);
    const turn = faulted(run('study painting', galleryCatalogue(), capped));
    expect(turn.fault).toMatchObject({ name: 'BudgetExhausted' });
    expect(turn.fault.detail).toContain('extensionEffects');
    expect(run('study painting').committed).toBe(true);
  });

  it('charges each argument as an expression is charged, and its run a step more', () => {
    const catalogue = galleryCatalogue();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const recorded = recordOf(SHOWN, frameIn(catalogue, budget), catalogue.extensions);
    expect(recorded).toEqual({
      extension: 'media',
      statement: 'show',
      payload: { src: 'hall.png', caption: 'the hall', self: HALL },
      transcript: '[A picture: the hall]',
    });
    // The picture read from its literal, the caption's literal, and the run.
    expect(budget.spentSteps).toBe(3);
  });
});

/** `media.show("hall.png", "the hall")` as the parser builds it. */
const SHOWN: ExtensionStatement = (() => {
  const source = new SourceFile('hall.sprout', 'media.show("hall.png", "the hall")');
  const ident = (text: string, start: number) => ({
    kind: 'ident' as const,
    at: source.span(start, start + text.length),
    text,
  });
  return {
    kind: 'extension-statement',
    at: source.span(0, source.text.length),
    extension: ident('media', 0),
    name: ident('show', 6),
    arguments: [
      { kind: 'string', at: source.span(11, 21), value: 'hall.png' },
      { kind: 'string', at: source.span(23, 33), value: 'the hall' },
    ],
  };
})();

/** A frame for the hall's own body, over the gallery as committed, charging `budget`. */
function frameIn(catalogue: Catalogue, budget: Budget): Frame {
  return {
    state: readerOf(gallery(catalogue)),
    kinds: catalogue.lookup,
    library: 'gallery',
    self: HALL,
    bindings: new Map(),
    budget,
    caps: catalogue.caps,
    names: catalogue.names,
    passes: () => true,
  };
}

describe('what one run records', () => {
  it('is nothing where the extension is absent, and nothing is charged for it', () => {
    const catalogue = galleryCatalogue([]);
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    expect(recordOf(SHOWN, frameIn(catalogue, budget), catalogue.extensions)).toBeNull();
    expect(budget.spentSteps).toBe(0);
  });

  it('gives the actor where one is bound, and none where nobody acts', () => {
    const actors: (string | null)[] = [];
    const catalogue = galleryCatalogue([
      mediaWith({
        run: (frame) => {
          actors.push(frame.actor);
          return { src: 'x', caption: 'y', self: frame.self };
        },
      }),
    ]);
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    recordOf(SHOWN, frameIn(catalogue, budget), catalogue.extensions);
    const acting = {
      ...frameIn(catalogue, budget),
      bindings: new Map([['actor', boundObject(PAINTING)]]),
    };
    recordOf(SHOWN, acting, catalogue.extensions);
    expect(actors).toEqual([null, PAINTING]);
  });
});

describe('a statement of an absent extension', () => {
  it('records nothing, so the reading that said nothing else is answered `nothing_happens`', () => {
    const turn = run('hear cat', galleryCatalogue([]));
    expect(shown(turn.effects)).toEqual([['said', MARTA, ['Nothing much comes of that.']]]);
  });

  it('records nothing in a description, which still reads its words', () => {
    const turn = run('look', galleryCatalogue([]));
    expect(shown(turn.effects)).toEqual([['described', MARTA, ['A bright hall.']]]);
  });
});
