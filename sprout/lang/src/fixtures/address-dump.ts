// What the C parser is held to before it reads a line (`corpus/goldens/addresses.json` and
// `corpus/goldens/parser-words.json`): the parser's word lists, and, for a visitor arriving in
// every corpus world, what each live instance is called and answers to and what the visitor may
// name, with how near and whether carried. Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { emitCartridge } from '../bundle/cartridge.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  ALL_WORDS,
  CONNECTORS,
  DETERMINERS,
  PARSER_WORDS,
  RELATIVE_WORDS,
} from '../declare/addressing.js';
import { ABBREVIATIONS, DIRECTIONS } from '../declare/directions.js';
import { MEDIA } from '../declare/media.js';
import { TYPED_PRONOUNS } from '../syntax/ast-grammar.js';
import { Budget } from '../runtime/budget.js';
import { loadCartridge } from '../runtime/cartridge.js';
import { Draft } from '../runtime/draft.js';
import { Draws } from '../runtime/draws.js';
import { isLive } from '../runtime/live.js';
import { saveWorld } from '../runtime/load.js';
import { addressOf } from '../runtime/parser/address.js';
import { writtenAs } from '../runtime/parser/nouns.js';
import { reachOf } from '../runtime/parser/reach.js';
import { passRules } from '../runtime/passes.js';
import { nicknamesIn } from '../runtime/state.js';
import { arrived } from './view-bench.js';

/** The parser's word lists, each in its order: what the C parser's `words.c` holds. */
export function parserWords() {
  return {
    determiners: DETERMINERS,
    connectors: CONNECTORS,
    relativeWords: RELATIVE_WORDS,
    allWords: ALL_WORDS,
    parserWords: PARSER_WORDS,
    directions: DIRECTIONS,
    typedPronouns: Object.entries(TYPED_PRONOUNS),
    abbreviations: [...ABBREVIATIONS],
  };
}

/**
 * For each world, a visitor arriving as the inspectors admit one: the state they arrive in; each
 * live instance as `[id, written, name, article, pronoun, nouns, adjectives]`, a noun its words
 * joined by spaces; and the visitor's candidates as `[id, near, carried]` with the steps reach spent.
 */
export function addressGoldens(worlds: readonly (readonly [string, Bundle])[]) {
  return worlds.map(([name, bundle]) => {
    const catalogue = loadCartridge(emitCartridge(bundle), {
      caps: DEFAULT_LIMITS.caps,
      installed: [MEDIA],
    });
    const { state, visit } = arrived(catalogue);
    const actor = state.visitors.get(visit)!.instance;
    const draft = new Draft(state);
    const nicknames = nicknamesIn(state);
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const addressing = { world: state.world, nicknames };
    const instances = [...state.instances.values()]
      .filter((instance) => isLive(draft, instance.id))
      .map((instance) => {
        const address = addressOf(instance, addressing);
        return [
          instance.id,
          writtenAs(address),
          address.name,
          address.article,
          address.pronoun,
          address.nouns.map((noun) => noun.join(' ')),
          address.adjectives,
        ];
      });
    const passes = passRules({
      state: draft,
      kinds: catalogue.lookup,
      caps: catalogue.caps,
      budget,
      names: catalogue.names,
    });
    const candidates = reachOf(actor, {
      state: draft,
      catalogue,
      budget,
      draws: new Draws(0),
      passes,
      nicknames,
      exits: [],
      referents: [],
      lastReading: null,
    }).map(({ instance, near, carried }) => [instance.id, near, carried]);
    return {
      world: name,
      state: JSON.stringify(saveWorld(state)),
      visit,
      instances,
      candidates,
      steps: budget.spentSteps,
    };
  });
}

/** The goldens as files: one line per world, so a change to one world is one changed line. */
export function addressText(made: ReturnType<typeof addressGoldens>): string {
  return `[\n${made.map((one) => JSON.stringify(one)).join(',\n')}\n]\n`;
}
