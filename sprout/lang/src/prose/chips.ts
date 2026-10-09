// The tree a chip client walks (the spec's The runtime › The view: a
// reading is offered as verb, fillers, the options of each value role,
// given per role in the order the verb declares them). The readings of a
// view are grouped by verb, then by the filler of each filled role in
// declared order, and end in the reading's typed line, its value options
// and the consent pass's refusal. Groups keep the order the view offers
// them in.

import type { SeenFiller, SeenOptions, SeenReading, SeenView } from './view.js';

/** Where a reading ends: the line that types it, why it is refused, and the options of its value roles. */
export interface ChipLeaf {
  readonly typed: string;
  /** The consent pass's refusal for the visitor; null where every participant consents. */
  readonly refused: readonly string[] | null;
  readonly options: readonly SeenOptions[];
}

/** One filler a role can take, and what follows it. */
export interface ChipChoice {
  readonly filler: SeenFiller;
  readonly next: ChipNode;
}

/** What follows a verb or a filler: the fillers the next role can take, or the reading it ends in. */
export interface ChipNode {
  /** The choices for the next filled role; empty where the reading ends here. */
  readonly choices: readonly ChipChoice[];
  /** The reading that ends here; null where more roles remain. */
  readonly leaf: ChipLeaf | null;
}

/** One verb, by its qualified name, and what follows it. */
export interface ChipVerb {
  readonly verb: string;
  readonly next: ChipNode;
}

/** A view's readings as a tree: verb, then each filled role's filler, then the leaf. */
export type ChipTree = readonly ChipVerb[];

interface GrowingNode {
  readonly choices: Map<string, { readonly filler: SeenFiller; readonly next: GrowingNode }>;
  leaf: ChipLeaf | null;
}

/** `view`'s readings as the tree a chip client walks. */
export function chipTree(view: Pick<SeenView, 'readings'>): ChipTree {
  const verbs = new Map<string, GrowingNode>();
  for (const reading of view.readings) {
    const root = verbs.get(reading.verb) ?? emptyNode();
    verbs.set(reading.verb, root);
    let node = root;
    for (const filler of reading.fillers.filter((one) => one.binds !== 'unbound')) {
      const key = JSON.stringify(filler);
      const choice = node.choices.get(key) ?? { filler, next: emptyNode() };
      node.choices.set(key, choice);
      node = choice.next;
    }
    node.leaf ??= leafOf(reading);
  }
  return [...verbs].map(([verb, node]) => ({ verb, next: frozen(node) }));
}

function emptyNode(): GrowingNode {
  return { choices: new Map(), leaf: null };
}

function leafOf({ typed, refused, options }: SeenReading): ChipLeaf {
  return { typed, refused, options };
}

function frozen(node: GrowingNode): ChipNode {
  return {
    choices: [...node.choices.values()].map(({ filler, next }) => ({
      filler,
      next: frozen(next),
    })),
    leaf: node.leaf,
  };
}
