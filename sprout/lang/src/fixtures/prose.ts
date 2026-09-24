// The mill the prose specs render in, and what they render with: a turn
// with a visitor called Marta standing in the yard, the context a
// renderer takes, and a passage of any object said to any reader. Spec
// support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS, type RuntimeBudgets } from '../bundle/limits.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { Budget } from '../runtime/budget.js';
import { catalogueOf } from '../runtime/catalogue.js';
import { Draft } from '../runtime/draft.js';
import type { Evaluated } from '../runtime/evaluate.js';
import { boundObject } from '../runtime/evaluate.js';
import { declaredId, type InstanceId } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import { newInstance } from '../runtime/state.js';
import type { Value } from '../runtime/values.js';
import type { RenderContext } from '../prose/render.js';
import { renderFor } from '../prose/speech.js';
import { compiledWorld } from './bundle.js';

const CAPS = DEFAULT_LIMITS.caps;

/**
 * A mill with a yard holding a press whose passages live in `press.prose`,
 * a crate holding an apple and two ribs, a brass key, an oak door, and an
 * echo whose passage renders itself.
 */
export const MILL: Bundle = compiledWorld('mill', {
  'world.sprout': [
    'world mill is sprout.World { contains visitors are Person visitors arrive at yard',
    '  object yard is sprout.Place {',
    '    object press is Press',
    '    object brass_key is Key',
    '    object oak_door is Plain { grammar { article an } }',
    '    object crate is Crate {',
    '      grammar { article the }',
    '      object apple is Plain { grammar { article an } }',
    '      object rib is Rib',
    '      object spare_rib is Rib',
    '    }',
    '    object echo is Echo',
    '  }',
    '}',
    'enum Mood { bone_dry, drowsy }',
    'verb ink { role target  role tools many  "ink [target] with [tools]"  "ink [target]" }',
    'kind Person is sprout.Visitor { }',
    'kind Plain { }',
    'kind Key { }',
    'kind Rib { passage short { a rib } }',
    'kind Crate {',
    '  contains',
    '  passage listing {',
    '    In the crate:',
    '    {for thing in self}{thing}{if $last}.{else}, {/if}{/for}',
    '',
    '    {for rib: Rib in self}{rib.short}{if $first} first{/if}{if !$last}, {/if}{/for}',
    '  }',
    '}',
    'kind Press {',
    '  prose "press.prose"',
    '  :mood Mood default bone_dry',
    '  :sheets 3 min 0 max 9',
    '  :label string default "the_albion"',
    '  :moods [Mood] default [bone_dry, drowsy]',
    '  as target for ink { do { say inked } }',
    '}',
    'kind Echo { passage ring { {self.ring} } }',
    '',
  ].join('\n'),
  'press.prose': [
    'passage inked {',
    '  {actor} inks {self} with {for t of tools}{t}{if $last}.{else}, {/if}{/for}',
    '}',
    'passage mood { {self.get(:mood)}, {self.get(:sheets)} sheets, labelled {self.get(:label)}. }',
    'passage moods { {for m of self.get(:moods)}{$index} of {$count}: {m}{if !$last}; {/if}{/for} }',
    'passage sheets {',
    '  {if self.get(:sheets) > 5}',
    '  Many sheets.',
    '  {else if self.get(:sheets) > 0}',
    '  Some sheets.',
    '  {else}',
    '  No sheets.',
    '  {/if}',
    '',
    '  {if self.get(:sheets) == 0}Nothing at all.{/if}',
    '',
    '  the end,\\nand a line kept. A brace: \\{.',
    '}',
    '',
  ].join('\n'),
});

const at = (...path: string[]): InstanceId => declaredId('mill', path);
export const YARD = at('yard');
export const PRESS = at('yard', 'press');
export const BRASS_KEY = at('yard', 'brass_key');
export const OAK_DOOR = at('yard', 'oak_door');
export const CRATE = at('yard', 'crate');
export const RIB = at('yard', 'crate', 'rib');
export const SPARE_RIB = at('yard', 'crate', 'spare_rib');
export const ECHO = at('yard', 'echo');

/** A turn in the mill, with Marta in the yard, rendering through `context`. */
export interface ProseTurn {
  readonly marta: InstanceId;
  readonly context: RenderContext;
  readonly draft: Draft;
}

/** A fresh turn over the mill with Marta standing in the yard. */
export function proseTurn(budgets: RuntimeBudgets = DEFAULT_LIMITS.budgets): ProseTurn {
  const catalogue = catalogueOf(MILL, CAPS);
  const draft = new Draft(initialState(catalogue));
  const marta = newInstance(
    draft.mint(),
    { from: 'visitor' },
    catalogue.visitorKind!,
    YARD,
    draft.nextSerial(),
    CAPS,
  );
  draft.add(marta);
  return {
    marta: marta.id,
    draft,
    context: {
      state: draft,
      catalogue,
      budget: new Budget(budgets),
      passes: (container) => (container === draft.world ? WORLD_PASSES_ANYTHING : true),
      nicknames: new Map([[marta.id, 'Marta']]),
    },
  };
}

/** `name`, as `by`'s kind has it, said with `bindings` and read by `reader`. */
export function passageFor(
  turn: ProseTurn,
  by: InstanceId,
  name: string,
  reader: InstanceId,
  bindings: Record<string, Evaluated> = {},
): string[] {
  const passage = turn.draft.instance(by)?.kind.passages.get(name);
  if (passage === undefined) throw new Error(`\`${by}\` has no passage \`${name}\`.`);
  return renderFor(
    { by, said: { passage }, bindings: new Map(Object.entries(bindings)) },
    reader,
    turn.context,
  );
}

/** Write `values` onto `id`'s properties in the turn's draft. */
export function setOn(turn: ProseTurn, id: InstanceId, values: Record<string, Value>): void {
  const instance = turn.draft.instance(id)!;
  turn.draft.write({
    ...instance,
    properties: new Map([...instance.properties, ...Object.entries(values)]),
  });
}

export { boundObject };
