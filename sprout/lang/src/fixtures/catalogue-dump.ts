// A catalogue as plain JSON: the ids, kinds, properties, verbs and typed
// phrases a loaded world declares, in the order the runtime tries them. The
// C runtime loads the same worlds from their cartridges and is held to this
// dump (`corpus/goldens/catalogues.json`), so the two readers agree on what a
// cartridge says.

import type { StaticCaps } from '../bundle/limits.js';
import type { Literal } from '../syntax/ast.js';
import { kindName, type KindRef } from '../declare/kinds.js';
import type { ResolvedPhrase, ResolvedVerb } from '../declare/verbs.js';
import type { Catalogue } from '../runtime/catalogue.js';
import { typeKey } from '../runtime/values.js';
import type { TypedPart } from '../runtime/parser/phrases.js';

export type DumpedDefault =
  | { readonly boolean: boolean }
  | { readonly number: number }
  | { readonly string: string }
  | { readonly option: string }
  | { readonly list: readonly DumpedDefault[] };

export interface DumpedKind {
  readonly name: string;
  readonly spawnable: boolean;
  readonly order: readonly string[];
  readonly contains: boolean;
  readonly containsActors: boolean;
  readonly properties: readonly {
    readonly name: string;
    readonly type: string;
    readonly remembered: boolean;
    readonly origin: string;
    readonly default: DumpedDefault;
  }[];
  readonly passages: readonly string[];
  readonly plays: readonly (readonly [string, number])[];
}

export interface DumpedCatalogue {
  readonly world: string;
  readonly arrival: string | null;
  readonly worldKind: string | null;
  readonly visitorKind: string | null;
  readonly declared: readonly (readonly [string, string, string | null, number])[];
  readonly kinds: readonly DumpedKind[];
  readonly verbs: readonly {
    readonly name: string;
    readonly roles: readonly (readonly [string, string, boolean, boolean, boolean])[];
    readonly phrases: readonly string[];
  }[];
  /** Each typed phrase as its verb, its parts (words, or `{n}` for a slot of role n) and the object it holds for. */
  readonly phrases: readonly (readonly [string, string, string | null])[];
  readonly intentPhrases: readonly (readonly [string, string])[];
  readonly messages: readonly (readonly [string, string | null])[];
  readonly words: readonly string[];
  readonly extensions: readonly (readonly [string, number])[];
  readonly caps: Readonly<Record<string, number | null>>;
}

function defaultOf(literal: Literal): DumpedDefault {
  switch (literal.kind) {
    case 'boolean':
      return { boolean: literal.value };
    case 'integer':
      return { number: literal.value };
    case 'string':
      return { string: literal.value };
    case 'option-literal':
      return { option: literal.name.text };
    case 'list-literal':
      return { list: literal.elements.map(defaultOf) };
  }
}

function kindOf(kind: KindRef, spawnable: boolean): DumpedKind {
  return {
    name: kindName(kind),
    spawnable,
    order: [...kind.order],
    contains: kind.contains,
    containsActors: kind.containsActors,
    properties: [...kind.properties.values()].map((property) => ({
      name: property.name,
      type: typeKey(property.type),
      remembered: property.remembered,
      origin: property.origin,
      default: defaultOf(property.declaration.default!),
    })),
    passages: [...kind.passages.keys()],
    plays: [...kind.plays].map(([key, plays]) => [key, plays.length] as const),
  };
}

const phraseText = (phrase: ResolvedPhrase): string =>
  phrase.parts.map((part) => (part.part === 'slot' ? `{${part.role}}` : part.text)).join('');

const partsText = (parts: readonly TypedPart[]): string =>
  parts.map((part) => ('slot' in part ? `{${part.slot}}` : part.words.join(' '))).join('|');

const verbName = (verb: ResolvedVerb): string => `${verb.library}.${verb.name}`;

/**
 * What a catalogue declares, as the dump the C runtime is held to. `recorded`
 * is what the cartridge says it was checked against, which a loaded
 * catalogue does not carry: it holds the host's caps instead.
 */
export function dumpCatalogue(catalogue: Catalogue, recorded: StaticCaps): DumpedCatalogue {
  const spawnable = new Set(catalogue.kinds.keys());
  const caps: Record<string, number | null> = { ...recorded };
  return {
    world: catalogue.world,
    arrival: catalogue.arrival,
    worldKind: catalogue.worldKind === null ? null : kindName(catalogue.worldKind),
    visitorKind: catalogue.visitorKind === null ? null : kindName(catalogue.visitorKind),
    declared: [...catalogue.declared.values()]
      .sort((a, b) => a.rank - b.rank)
      .map((one) => [
        one.id,
        one.container,
        one.kind === null ? null : kindName(one.kind),
        one.rank,
      ]),
    kinds: catalogue.lookup.all().map((kind) => kindOf(kind, spawnable.has(kindName(kind)))),
    verbs: catalogue.verbs.all().map((verb) => ({
      name: verbName(verb),
      roles: verb.roles.map((role) => [
        role.name,
        role.filler === null
          ? 'none'
          : role.filler.fills === 'kind'
            ? `kind ${kindName(role.filler.kind)}`
            : role.filler.fills,
        role.many,
        role.optional,
        role.carried,
      ]),
      phrases: verb.phrases.map(phraseText),
    })),
    phrases: catalogue.phrases.map((one) => [verbName(one.verb), partsText(one.parts), one.only]),
    intentPhrases: catalogue.intentPhrases.map((one) => [
      `${one.intent.library}.${one.intent.name}`,
      partsText(one.parts),
    ]),
    messages: catalogue.messages
      .all()
      .map((one) => [
        `${one.library}.${one.name}`,
        one.carries === null ? null : typeKey(one.carries),
      ]),
    words: [...catalogue.words],
    extensions: [...catalogue.extensions.values()].map((one) => [one.name, one.major] as const),
    caps,
  };
}
