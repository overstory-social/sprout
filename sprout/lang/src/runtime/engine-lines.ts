// The engine's lines, as it says them (the spec's Prose › Engine lines).
// Each is found on the one the line is about, then that one's place,
// then the world: the first passage of the line's name that is not
// written `default`, or, where every one found is, the nearest. Where
// nothing along the way writes the line at all, as where the library
// file that writes it is absent, the engine says the standard library's
// words itself, so no line of the engine's is ever silent. A line the
// engine speaks with no passage to say it through is read here too, as
// a one-line passage (the spec's Prose › Passages).

import type { EngineLineName } from '../declare/engine-passages.js';
import { ownerOf } from '../declare/engine-passages.js';
import { SPROUT } from '../declare/enums.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import { parseProse } from '../syntax/parse.js';
import type { Speech } from './body.js';
import type { InstanceId } from './ids.js';
import type { StateReader } from './state.js';

/** The standard library's words for each line, which the engine says where nothing writes one. */
export const STOCK_LINES: Readonly<Record<EngineLineName, string>> = {
  unknown: 'That is not something you can do here.',
  not_here: 'You see nothing like that here.',
  cannot: "You can't {reading}.",
  not_carrying: "You aren't carrying {thing}.",
  meant: '({thing})',
  pronoun_correction: '{thing} is a {pronoun}.',
  nothing_happens: 'Nothing much comes of that.',
  unremarkable: 'There is nothing special about {thing}.',
  unseen: 'Something here is too much to take in.',
  dark: 'It is too dark to see.',
  fault: 'Something in this world has gone wrong, and nothing has changed.',
  missing:
    'This world uses something this host does not provide, and will be missing some of itself.',
  displaced: 'The place you were standing is gone.',
  inside_itself: '{item} cannot go inside itself.',
  crowded: 'There is no room in {to} for {item}.',
  waited: 'Time passes.',
  help: 'You can type: {for reading of readings}{reading}{if $last}.{else}, {/if}{/for}',
  acted: '{actor} tries to {reading}.',
  gone_away: 'You leave, and take what you carry with you.',
  npc_says: '{actor} says "{words}"',
  arrives: '{item} arrives{if bound from} from {from}{/if}.',
  leaves: '{item} leaves{if bound to} for {to}{/if}.',
  inventory:
    '{if self.count == 0}You are carrying nothing.{else} You are carrying {for thing in self}{thing}{if $last}.{else}, {/if}{/for}{/if}',
};

/** A line of the engine's, read as a one-line passage; a line that does not read is the engine's defect. */
export function engineLine(text: string): Extract<Speech, { readonly prose: unknown }> {
  const diagnostics = new Diagnostics();
  const prose = parseProse(new SourceFile('the engine', text), diagnostics);
  if (diagnostics.refused) {
    throw new Error(`the engine's line "${text}" does not read: ${diagnostics.render()}`);
  }
  return { text, prose, library: SPROUT };
}

/** An engine line as it is said: the passage or stock words, and who says it, which is `self` as it renders. */
export interface EngineSaid {
  readonly by: InstanceId;
  readonly said: Speech;
}

/**
 * `name` as the engine says it of `about` standing in `place`: the first
 * found of `about`'s own, `place`'s and the world's, a `default` yielding
 * to any other; the stock words where none writes it. Either may be null
 * where there is none, as for a line said to nobody in particular.
 */
export function engineSaid(
  state: StateReader,
  name: EngineLineName,
  about: InstanceId | null,
  place: InstanceId | null,
): EngineSaid {
  let yielding: EngineSaid | null = null;
  for (const id of [about, place, state.world]) {
    if (id === null) continue;
    const passage = state.instance(id)?.kind.passages.get(name);
    if (passage === undefined) continue;
    if (!passage.yields) return { by: id, said: { passage } };
    yielding ??= { by: id, said: { passage } };
  }
  if (yielding !== null) return yielding;
  const owner = ownerOf(name);
  const by = (owner === 'Place' ? place : owner === 'Actor' ? about : null) ?? state.world;
  return { by, said: engineLine(STOCK_LINES[name]) };
}
