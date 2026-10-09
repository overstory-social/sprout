// Loading a cartridge (the spec's The compiler › What compiling produces):
// the bytes `emitCartridge` wrote, read back into the same `Catalogue`
// compiling the source would have fed a turn. Nothing is parsed or checked
// here; the cartridge holds a world that published, resolved. What a
// cartridge cannot hold is the host's code, so the extensions a world pins
// are supplied by the host loading it, as they are at a compile.

import type { StaticCaps } from '../bundle/limits.js';
import { readCartridge } from '../bundle/cartridge.js';
import { readGraph } from '../bundle/cartridge-graph.js';
import { lookingFrom, SPROUT } from '../declare/enums.js';
import { pinExtensions, type Extension } from '../declare/extensions.js';
import type { KindContents } from '../declare/contents.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import type { DeclaredMessage, MessageLookup } from '../declare/messages.js';
import type { Placement } from '../declare/tree.js';
import type { ScopedSynonym } from '../declare/synonyms.js';
import type { ResolvedIntent } from '../declare/intents.js';
import type { ResolvedVerb, VerbLookup } from '../declare/verbs.js';
import type { NameTable } from '../check/names.js';
import type { Node } from '../source/nodes.js';
import { catalogueFrom, type Catalogue } from './catalogue.js';

/**
 * What a host brings to a cartridge: the caps it runs the world under, which
 * are the host's and read at every load (the spec's Limits), and the
 * extensions it has installed. The caps the cartridge records are what the
 * world was checked against at publish, and are not what it runs under.
 */
export interface CartridgeHost {
  readonly caps: StaticCaps;
  /** The extensions installed; a pinned one the host lacks is absent, as at a compile. */
  readonly installed?: readonly Extension[];
}

/** The three ways a bundle finds a declared thing: by full identity, from where a body is written, and all. */
function lookupOf<T extends { readonly library: string; readonly name: string }>(
  items: readonly T[],
): {
  qualified(library: string, name: string): T | null;
  unqualified(name: string, from: string): T | null;
  all(): readonly T[];
} {
  const find = (library: string, name: string): T | null =>
    items.find((item) => item.library === library && item.name === name) ?? null;
  return {
    qualified: find,
    unqualified: (name, from) => find(lookingFrom(from), name) ?? find(SPROUT, name),
    all: () => items,
  };
}

/**
 * The catalogue a cartridge describes. Refuses, in words, a file that is
 * not a cartridge, is damaged, or was made for a newer format or level.
 */
export function loadCartridge(bytes: Uint8Array, host: CartridgeHost): Catalogue {
  const cartridge = readCartridge(bytes);
  const pinned = pinExtensions(cartridge.extensions, host.installed ?? []);
  const graph = readGraph(
    {
      files: cartridge.table.files,
      prose: cartridge.prose.entries,
      bodies: cartridge.bodies.entries,
      rest: cartridge.table.entries,
    },
    (object) => {
      if (
        'phrases' in object &&
        !('synonyms' in object) &&
        ('roles' in object || 'name' in object)
      ) {
        object['synonyms'] = [];
      }
      if ('verb' in object && 'phrases' in object && 'object' in object && !('words' in object)) {
        object['words'] = '';
      }
      if (object['type'] !== 'extension' || typeof object['extension'] !== 'string') return;
      const types = pinned.get(object['extension'])?.installed?.types;
      object['definition'] = types?.find((type) => type.name === object['name']) ?? null;
    },
  );
  const kinds = graph.read(cartridge.kinds.all) as readonly KindRef[];
  const verbs = graph.read(cartridge.verbs) as readonly ResolvedVerb[];
  const messages = graph.read(cartridge.messages) as readonly DeclaredMessage[];
  const kindLookup: KindLookup = lookupOf(kinds);
  const verbLookup: VerbLookup = lookupOf(verbs);
  const messageLookup: MessageLookup = lookupOf(messages);
  return catalogueFrom(
    {
      name: cartridge.header.name,
      holds: graph.read(cartridge.tree.holds) as ReadonlyMap<string, Placement>,
      world: graph.read(cartridge.kinds.world) as KindRef | null,
      visitor: graph.read(cartridge.kinds.visitor) as KindRef | null,
      kinds,
      contents: graph.read(cartridge.kinds.contents) as KindContents,
      kindLookup,
      verbs: verbLookup,
      synonyms: graph.read(cartridge.grammar.scoped) as readonly ScopedSynonym[],
      intents: graph.read(cartridge.grammar.intents) as readonly ResolvedIntent[],
      messages: messageLookup,
      names: graph.read(cartridge.bodies.names) as NameTable,
      optionSlots: graph.read(cartridge.bodies.optionSlots) as ReadonlySet<Node>,
      arrival: cartridge.tree.arrival,
      words: cartridge.grammar.words,
      extensions: [...pinned.values()],
    },
    host.caps,
  );
}
