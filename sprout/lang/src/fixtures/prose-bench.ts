// The world the prose goldens are written about, and the oracle's rendering of every case in
// it (`prose-cases.ts`): a yard holding a press, a crate, an echo whose passages hold every
// slot, a cat that speaks, and a handler for each string a case says; two visitors in it,
// and a spawned thing. A case's lines are rendered by `renderEffects`, the way a turn
// renders what its bodies said, and the golden records what each reader read, the steps
// it cost, whom it cut short, or the fault that ended it. Spec support: the package build
// leaves it out.

import { compiledWorld } from './bundle.js';
import type { Bundle } from '../bundle/bundle.js';
import { emitCartridge } from '../bundle/cartridge.js';
import { DEFAULT_LIMITS, type RuntimeBudgets } from '../bundle/limits.js';
import type { EngineLineName } from '../declare/engine-passages.js';
import { renderEffects } from '../prose/effects.js';
import { Budget, BudgetExhausted } from '../runtime/budget.js';
import { catalogueOf } from '../runtime/catalogue.js';
import { Draft } from '../runtime/draft.js';
import { Draws } from '../runtime/draws.js';
import type { Effect, Unrendered } from '../runtime/effects.js';
import { engineLine, engineSaid, STOCK_LINES } from '../runtime/engine-lines.js';
import { boundObject, boundReadings, boundValue, type Evaluated } from '../runtime/evaluate.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from '../runtime/ids.js';
import { initialState, loadWorld, saveWorld } from '../runtime/load.js';
import { passRules } from '../runtime/passes.js';
import { turnState, type Said } from '../runtime/reading.js';
import { newInstance, type VisitorRecord } from '../runtime/state.js';
import type { Speech } from '../runtime/body.js';
import type { Bind, Line, ProseCase, Say, StateName, Who } from './prose-cases.js';
import { PROSE_CASES } from './prose-cases.js';

const WORLD = 'bench';
/** The words of the engine's refusal of a move into what holds no actors, which are no named passage. */
const NOT_A_PLACE_LINE = 'not_a_place';
const NOT_A_PLACE = '{item} cannot stand in {to}.';
const CAPS = DEFAULT_LIMITS.caps;

/** The strings the cases say, each written by a handler of the bench's `Sayer`. */
function textsOf(cases: readonly ProseCase[]): string[] {
  const texts = cases.flatMap((one) =>
    one.lines.flatMap((line) => ('text' in line.say ? [line.say.text] : [])),
  );
  return [...new Set(texts)];
}

const TEXTS = textsOf(PROSE_CASES);

/** A string as source writes it. */
const quoted = (text: string): string =>
  `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/** Words the lexer reads as prose, written with their escapes so the source holds what the case means. */
const sayer = (): string =>
  [
    'kind Sayer {',
    ...TEXTS.map((text, i) => `  on :t${i} (who, value) { tell ${quoted(text)} }`),
    '}',
  ].join('\n');

const MESSAGES = TEXTS.map((_, i) => `message :t${i} with integer`).join('\n');

const FILES: Record<string, string> = {
  'bench.sprout': [
    `world ${WORLD} is sprout.World {`,
    '  visitors are Person',
    '  visitors arrive at yard',
    '  object yard is sprout.Place {',
    '    object press is Press',
    '    object brass_key is Key',
    '    object oak_door is Plain',
    '    object crate is Crate {',
    '      grammar { article the }',
    '      object apple is Plain { grammar { article an } }',
    '      object rib is Rib',
    '      object spare_rib is Rib',
    '    }',
    '    object echo is Echo',
    '    object cat is Cat',
    '    object owl is Plain',
    '    object tin_cup is Plain { grammar { name "dented cup" } }',
    '    object dune is Plain { grammar { article none } }',
    '    object sayer is Sayer',
    '  }',
    '  object shed is sprout.Place { object mole is Plain }',
    '}',
    'enum Mood { bone_dry, drowsy }',
    'verb ink { role target  role tools many  "ink [target] with [tools]"  "ink [target]" }',
    MESSAGES,
    'kind Person is sprout.Visitor {',
    '  passage carrying { You are carrying {for thing in self}{thing}{if $last}.{else}, {/if}{/for} }',
    '}',
    'kind Plain { }',
    'kind Key { }',
    'kind MazeCell { passage named { {self} } }',
    'kind Rib { passage short { a rib } }',
    'kind Cat is sprout.Actor {',
    '  grammar { name "tabby cat" }',
    '  passage purr { {one of}Mrrp{or}Prrrr{or}Mew{/one of} }',
    '}',
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
    'kind Echo {',
    '  passage ring { {self.ring} }',
    '  passage tier1 { one, {self.tier2} }',
    '  passage tier2 { two, {self.tier3} }',
    '  passage tier3 { three }',
    '  passage call { {one of}Hello{or}Halloo{or}Who is there{/one of}, {actor}. }',
    '  passage calls { {for t of tools}{one of}ah{or}oh{/one of}{if !$last} {/if}{/for} }',
    '  passage toss { {if chance(2)}Heads{else}Tails{/if}, and {self.call} }',
    '  passage hum { {one of}Hmm{/one of}, {actor}. }',
    '  passage things { {crate}, {owl}, {tin_cup}, {dune}, {brass_key} }',
    '  passage nearby { {if press.is(Press)}{press.get(:label)}{else}no press{/if} }',
    `  passage pathed { {${WORLD}.yard.crate} holds {${WORLD}.yard.crate.count}, {${WORLD}.yard.crate.rib.short} first }`,
    '  passage short {  an echo  }',
    '  passage long {',
    '',
    '    it rings,',
    '',
    '    it fades,',
    '',
    '  }',
    '  passage heard { You hear {self.short}. }',
    '  passage faded { First {self.long} then quiet. }',
    '  passage tail { \\n\\nit carries. }',
    '  passage carried { It rings.{self.tail} }',
    '  passage turn { \\nit carries. }',
    '  passage lined { It rings.{self.turn} }',
    '  :loud false',
    '  passage aside {',
    '',
    '    {if self.get(:loud)}it is loud.{/if}',
    '',
    '  }',
    '  passage room { Quiet here.{self.aside} }',
    '  passage quoted { “hello there,” she said. }',
    '  passage bracketed { (the wooden rib) stands. }',
    '  passage dashed { —and then silence. }',
    '  passage digit { 3 pots stand. }',
    '  passage wide { 　　a  b﻿　c   d.  }',
    '  passage sharp { ßeta is not sharp. }',
    '  passage digraph { ǆungla grows. }',
    '  passage apostrophe { ŉ is odd. }',
    '  passage ligature { ﬃ is a ligature. }',
    '  passage greek { ΐ is a vowel. }',
    '  passage dotless { ıi is dotless. }',
    '  passage astral { 𐐨 is deseret. }',
    '  passage emoji { 😀 smile }',
    '  passage cased { ǅ is title. }',
    '  as target for ink { do { say call  say calls  say toss  say hum } }',
    '}',
    sayer(),
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
};

/** The bench world as a compiled bundle. */
export const BENCH: Bundle = compiledWorld(WORLD, FILES);

/** The bench as a cartridge, which the C runtime loads. */
export const BENCH_CARTRIDGE: Uint8Array = emitCartridge(BENCH);

const catalogue = catalogueOf(BENCH, CAPS);
const at = (...path: string[]): InstanceId => declaredId(WORLD, path);

/** What a state is built from: the instances it names. */
interface Built {
  readonly stored: ReturnType<typeof saveWorld>;
  readonly named: Readonly<Record<string, InstanceId>>;
}

/** A visitor with a record, standing at `place`. */
function arrive(draft: Draft, visit: string, nickname: string, place: InstanceId): InstanceId {
  const instance = draft.mint();
  draft.add(
    newInstance(
      instance,
      { from: 'visitor' },
      catalogue.visitorKind!,
      place,
      draft.nextSerial(),
      CAPS,
    ),
  );
  draft.putVisitor({
    visit: visitKey(visit),
    nickname,
    instance,
    lastPlace: place,
    referents: [],
    lastReading: null,
  });
  return instance;
}

/** The states the cases run in, as a store keeps them. */
function states(): Record<StateName, Built> {
  const build = (laden: boolean): Built => {
    const draft = new Draft(initialState(catalogue));
    const marta = arrive(draft, 'visit-1', 'Marta', at('yard'));
    const ines = arrive(draft, 'visit-2', 'Ines', at('yard'));
    const cell = draft.mint();
    draft.add(
      newInstance(
        cell,
        { from: 'spawned', kind: `${WORLD}.MazeCell` },
        catalogue.kinds.get(`${WORLD}.MazeCell`)!,
        at('yard'),
        draft.nextSerial(),
        CAPS,
      ),
    );
    if (laden) {
      draft.place(at('yard', 'brass_key'), marta);
      draft.place(at('yard', 'oak_door'), marta);
    }
    return { stored: saveWorld(draft.commit().state), named: { marta, ines, cell } };
  };
  return { yard: build(false), laden: build(true) };
}

const BUILT = states();

/** What `who` is in `state`. */
function resolver(state: StateName): (who: Who) => InstanceId {
  const { named } = BUILT[state];
  return (who) => named[who] ?? at(...who.split('.'));
}

/** What a binding is bound to. */
function bound(bind: Bind, resolve: (who: Who) => InstanceId): Evaluated {
  if (typeof bind === 'string') return boundObject(resolve(bind));
  if ('set' in bind) return { binds: 'set', ids: bind.set.map(resolve) };
  if ('readings' in bind) return boundReadings(bind.readings);
  return boundValue(bind.value);
}

/** The speech a line has, and the object whose body says it. */
function speechOf(
  say: Say,
  by: InstanceId,
  state: Draft,
  resolve: (who: Who) => InstanceId,
): { readonly by: InstanceId; readonly said: Speech } {
  if ('passage' in say) {
    const passage = state.instance(by)?.kind.passages.get(say.passage);
    if (passage === undefined) throw new Error(`\`${by}\` has no passage \`${say.passage}\`.`);
    return { by, said: { passage } };
  }
  if ('text' in say) return { by, said: { ...engineLine(say.text), library: WORLD } };
  if ('absent' in say) return { by, said: { absent: say.absent } };
  if ('stock' in say) {
    const words =
      say.stock === NOT_A_PLACE_LINE ? NOT_A_PLACE : STOCK_LINES[say.stock as EngineLineName];
    return { by, said: engineLine(words) };
  }
  return engineSaid(
    state,
    say.engine as EngineLineName,
    say.about === undefined ? null : resolve(say.about),
    say.place === undefined ? null : resolve(say.place),
  );
}

/** The wire name the C runtime records a speech under. */
function speechJson(speech: Speech): unknown {
  if ('passage' in speech)
    return { passage: { origin: speech.passage.origin, name: speech.passage.name } };
  if ('absent' in speech) return { absent: speech.absent };
  if ('recorded' in speech) throw new Error('an extension’s effect is not a prose case.');
  if (speech.library === 'sprout') {
    const stock = Object.entries(STOCK_LINES).find(([, words]) => words === speech.text);
    if (stock !== undefined) return { engine: stock[0] };
    if (speech.text === NOT_A_PLACE) return { engine: NOT_A_PLACE_LINE };
  }
  return { text: speech.text, library: speech.library };
}

/** A line as the golden holds it, and as the oracle renders it. */
function lineOf(
  line: Line,
  draft: Draft,
  resolve: (who: Who) => InstanceId,
): { readonly json: Record<string, unknown>; readonly said: Said } {
  const given = line.by === undefined ? null : resolve(line.by);
  const found = speechOf(line.say, given ?? draft.world, draft, resolve);
  const effect = line.effect ?? 'said';
  const bindings = new Map(
    Object.entries(line.bind ?? {}).map(([name, one]) => [name, bound(one, resolve)]),
  );
  const speaker = line.speaker === undefined ? null : resolve(line.speaker);
  const said: Said = {
    effect,
    to: line.to.map(resolve),
    by: found.by,
    speaker,
    said: found.said,
    bindings,
  };
  return {
    said,
    json: {
      effect,
      to: said.to,
      by: found.by,
      speaker,
      said: speechJson(found.said),
    },
  };
}

/** The golden's form of a binding: resolved to what the C runtime reads. */
function resolvedBinds(line: Line, resolve: (who: Who) => InstanceId): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(line.bind ?? {}).map(([name, one]) => {
      const evaluated = bound(one, resolve);
      switch (evaluated.binds) {
        case 'object':
          return [name, { object: evaluated.id }];
        case 'set':
          return [name, { set: evaluated.ids }];
        case 'readings':
          return [name, { readings: evaluated.typed }];
        case 'value':
          return [name, { value: evaluated.value }];
      }
    }),
  );
}

/** The wire names the C runtime's host budgets are filled from. */
function figuresJson(budgets: RuntimeBudgets): Record<string, number | null> {
  return {
    steps: budgets.steps,
    output: budgets.output,
    passageDepth: budgets.passageDepth,
  };
}

function effectJson(effect: Effect): Record<string, unknown> {
  return {
    kind: effect.kind,
    from: effect.from,
    to: effect.to,
    visit: effect.visit,
    paragraphs: effect.paragraphs,
  };
}

/** Run one case against the oracle: what each reader read, or what faulted the turn. */
function run(one: ProseCase): Record<string, unknown> {
  const state = one.state ?? 'yard';
  const resolve = resolver(state);
  const draft = new Draft(loadWorld(BUILT[state].stored, catalogue).state);
  for (const [who, nickname] of Object.entries(one.renames ?? {})) {
    const instance = resolve(who);
    const record = draft.everyVisitor().find((visitor) => visitor.instance === instance)!;
    draft.putVisitor({ ...record, nickname });
  }
  const budgets: RuntimeBudgets = { ...DEFAULT_LIMITS.budgets, ...one.figures };
  const budget = new Budget(budgets);
  const passes = passRules({
    state: draft,
    kinds: catalogue.lookup,
    caps: catalogue.caps,
    budget,
    names: catalogue.names,
  });
  const draws = new Draws(one.seed ?? 1);
  for (let i = 0; i < (one.skip ?? 0); i++) draws.below(7);
  const made = one.lines.map((line) => lineOf(line, draft, resolve));
  const records: VisitorRecord[] = draft.everyVisitor();
  const actor = one.actor === undefined || one.actor === null ? null : resolve(one.actor);
  const lines: Unrendered[] = made.map(({ said }) => ({ said }));
  const bound = {
    limits: figuresJson(budgets),
    renames: Object.fromEntries(
      Object.entries(one.renames ?? {}).map(([who, nickname]) => [resolve(who), nickname]),
    ),
    lines: made.map(({ json }, i) => ({
      ...json,
      bindings: resolvedBinds(one.lines[i]!, resolve),
    })),
  };
  try {
    const effects = renderEffects(lines, {
      nicknames: new Map(records.map((one) => [one.instance, one.nickname])),
      visits: new Map<InstanceId, VisitKey>(records.map((one) => [one.instance, one.visit])),
      state: turnState(draft),
      catalogue,
      passes,
      budget,
      draws,
      actor,
    });
    return {
      ...bound,
      expect: {
        steps: budget.spentSteps,
        effects: effects.map(effectJson),
        cut: [...budget.cutShort],
      },
    };
  } catch (thrown) {
    if (!(thrown instanceof BudgetExhausted)) throw thrown;
    return {
      ...bound,
      expect: {
        fault: 'BudgetExhausted',
        budget: thrown.limit,
        limit: thrown.allowed,
        steps: budget.spentSteps,
      },
    };
  }
}

/** Everything the goldens hold, as data: the states, and every case with what the oracle rendered. */
export function proseGoldens(): {
  readonly states: Record<string, string>;
  readonly cases: readonly Record<string, unknown>[];
} {
  return {
    states: Object.fromEntries(
      Object.entries(BUILT).map(([name, built]) => [name, JSON.stringify(built.stored)]),
    ),
    cases: PROSE_CASES.map((one) => ({
      name: one.name,
      area: one.area,
      state: one.state ?? 'yard',
      seed: one.seed ?? 1,
      skip: one.skip ?? 0,
      actor:
        one.actor === undefined || one.actor === null
          ? null
          : resolver(one.state ?? 'yard')(one.actor),
      ...run(one),
    })),
  };
}
