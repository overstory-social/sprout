import { describe, expect, it } from 'vitest';

import { compileWorld, compiledWorld } from '../fixtures/bundle.js';
import { actorOf, gatehouse, gateHost, INES, MARTA, YARD } from '../fixtures/view.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { catalogueOf } from '../runtime/catalogue.js';
import { Draft } from '../runtime/draft.js';
import { declaredId } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import { newInstance } from '../runtime/state.js';
import { renderEffects } from './effects.js';
import { renderActed } from './acted.js';

const BOTH = [
  [MARTA, 'Marta', YARD],
  [INES, 'Ines', YARD],
] as const;

describe('the world’s `acted`', () => {
  it('reads, by default, as the actor trying the line they typed, named for the reader', () => {
    const state = gatehouse(BOTH);
    expect(renderActed(state, gateHost(), MARTA, actorOf(state, INES), 'take pebble')).toEqual([
      'Ines tries to take pebble.',
    ]);
  });

  it('is the world’s own line where the world writes one', () => {
    const bundle = compiledWorld('porch', {
      'porch.sprout': `world porch is sprout.World {
  visitors are Walker
  visitors arrive at step
  passage acted { {actor} has a go at "{reading}". }
  object step is sprout.Place
}
`,
      'walker.sprout': 'kind Walker is sprout.Visitor { }\n',
    });
    const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
    const draft = new Draft(initialState(catalogue));
    const step = declaredId('porch', ['step']);
    for (const [visit, nickname] of [
      [MARTA, 'Marta'],
      [INES, 'Ines'],
    ] as const) {
      const id = draft.mint();
      draft.add(
        newInstance(
          id,
          { from: 'visitor' },
          catalogue.visitorKind!,
          step,
          draft.nextSerial(),
          catalogue.caps,
        ),
      );
      draft.putVisitor({ visit, nickname, instance: id, lastPlace: step });
    }
    const state = draft.commit().state;
    const host = { catalogue, budgets: DEFAULT_LIMITS.budgets, render: renderEffects };
    expect(renderActed(state, host, MARTA, actorOf(state, INES), 'look')).toEqual([
      'Ines has a go at "look".',
    ]);
  });

  it('is nothing for a reader who has never visited', () => {
    const state = gatehouse([[MARTA, 'Marta', YARD]]);
    expect(renderActed(state, gateHost(), INES, actorOf(state, MARTA), 'look')).toBeNull();
  });

  it('may not draw, since nothing that says it draws', () => {
    const { bundle, diagnostics } = compileWorld('porch', {
      'porch.sprout': `world porch is sprout.World {
  visitors are Walker
  visitors arrive at step
  passage acted { {actor} {one of}tries{or}attempts{/one of} to {reading}. }
  object step is sprout.Place
}
`,
      'walker.sprout': 'kind Walker is sprout.Visitor { }\n',
    });
    expect(bundle).toBeNull();
    expect(diagnostics.map((d) => d.message).join('\n')).toContain("The world's `acted`");
  });
});
