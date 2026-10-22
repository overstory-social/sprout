// Whether a save of one build of a world survives a later build (the spec's
// The runtime › State › Across versions): every change between the two
// catalogues that touches what the stored form names. The stored form is
// the diff from a fresh load, so what it can name is the world's name, the
// declared objects by path, the kinds a spawn names, what a kind's body
// gives, and each of their properties with its type and default; anything
// else a later build changes is laid over a save without harm. The check
// is conservative: what could be named counts, whether or not a world ever
// writes it.

import type { ResolvedProperty } from '../declare/properties.js';
import { givenBy, type KindContent, type KindContents } from '../declare/contents.js';
import { kindName, type KindRef } from '../declare/kinds.js';
import { describeType, type ValueType } from '../declare/types.js';
import type { Literal } from '../syntax/ast.js';
import type { Span } from '../source/source.js';
import type { Catalogue } from './catalogue.js';

/** One change that would leave a save of the earlier build unreadable or wrong under the later. */
export interface SaveBreak {
  /** Where it is: in the later build where the thing is there, in the earlier where it is gone; null where neither kept a place. */
  readonly at: Span | null;
  readonly in: 'earlier' | 'later';
  readonly message: string;
  /** What to write instead, short of a breaking version, which every break also allows. */
  readonly remedy: string;
}

/** Where a span is, or null for a span a cartridge kept no place for. */
function placed(span: Span): Span | null {
  return span.source.name === '' ? null : span;
}

/** A default as an author writes it. */
function shownLiteral(literal: Literal | null): string {
  if (literal === null) return 'nothing';
  switch (literal.kind) {
    case 'boolean':
    case 'integer':
      return String(literal.value);
    case 'string':
      return JSON.stringify(literal.value);
    case 'option-literal':
      return literal.name.text;
    case 'list-literal':
      return `[${literal.elements.map(shownLiteral).join(', ')}]`;
  }
}

/** The options of `earlier` that `later` does not hold, anywhere in the type; null where `later` holds every value `earlier` did. */
function lostValues(earlier: ValueType, later: ValueType): readonly string[] | null {
  if (earlier.type !== later.type) return [];
  switch (earlier.type) {
    case 'boolean':
    case 'string':
      return null;
    case 'integer': {
      const wider = later as typeof earlier;
      return wider.min <= earlier.min && wider.max >= earlier.max ? null : [];
    }
    case 'symbol': {
      const options = (later as typeof earlier).of.options;
      const lost = earlier.of.options.filter((option) => !options.includes(option));
      return lost.length === 0 ? null : lost;
    }
    case 'list':
      return lostValues(earlier.element, (later as typeof earlier).element);
    case 'extension': {
      const other = later as typeof earlier;
      return other.extension === earlier.extension && other.name === earlier.name ? null : [];
    }
  }
}

/** `a`, `a and b`, `a, b and c`, each in backticks. */
function listed(words: readonly string[]): string {
  const ticked = words.map((word) => `\`${word}\``);
  return ticked.length === 1
    ? ticked[0]!
    : `${ticked.slice(0, -1).join(', ')} and ${ticked.at(-1)}`;
}

const AGAIN = 'or make this a breaking version.';

/** Where the breaks gather, each said once however many things share the declaration it is about. */
interface Breaks {
  readonly list: SaveBreak[];
  add(key: string, at: Span | null, side: SaveBreak['in'], message: string, remedy: string): void;
  /** A kind as a message names it: the world's own by its name alone, `Lamp`, a library's in full. */
  shown(qualified: string): string;
}

function gathering(world: string): Breaks {
  const list: SaveBreak[] = [];
  const said = new Set<string>();
  return {
    list,
    add(key, at, side, message, remedy) {
      if (said.has(key)) return;
      said.add(key);
      list.push({ at: at === null ? null : placed(at), in: side, message, remedy });
    },
    shown: (qualified) =>
      qualified.startsWith(`${world}.`) ? qualified.slice(world.length + 1) : qualified,
  };
}

/** A property as a message names it: `` `:lit` of `Lamp` ``, or what `Lamp` remembers. */
function propertyOf(property: ResolvedProperty, breaks: Breaks): string {
  const origin = breaks.shown(property.origin);
  return property.remembered
    ? `\`:${property.name}\`, which \`${origin}\` remembers for each person,`
    : `\`:${property.name}\` of \`${origin}\``;
}

/** What a kind held in the earlier build that the later no longer holds alike. */
function compareProperties(earlier: KindRef, later: KindRef, breaks: Breaks): void {
  for (const [name, before] of earlier.properties) {
    const after = later.properties.get(name);
    const what = propertyOf(before, breaks);
    if (after === undefined) {
      breaks.add(
        `gone|${before.origin}|${name}`,
        before.declaration.at,
        'earlier',
        `${what} is gone: a save that changed it cannot be read.`,
        `Declare it again as it was, ${AGAIN}`,
      );
      continue;
    }
    if (after.remembered !== before.remembered) {
      breaks.add(
        `moved|${after.origin}|${name}`,
        after.declaration.at,
        'later',
        `${what} is now ${after.remembered ? 'remembered for each person' : 'held by the thing itself'}: a save keeps the two apart, so what it holds of it cannot be read.`,
        `Keep it ${before.remembered ? 'remembered' : 'held'} as it was, ${AGAIN}`,
      );
      continue;
    }
    const lost = lostValues(before.type, after.type);
    if (lost !== null) {
      const gone =
        lost.length === 0
          ? ''
          : `${listed(lost)} ${lost.length === 1 ? 'is' : 'are'} no longer one of its options, so `;
      breaks.add(
        `type|${after.origin}|${name}`,
        after.declaration.at,
        'later',
        `${what} held ${describeType(before.type)}, and now holds ${describeType(after.type)}: ${gone}a save that holds a value it no longer can cannot be read.`,
        `Let it hold every value it held again, ${AGAIN}`,
      );
      continue;
    }
    const was = shownLiteral(before.declaration.default);
    const now = shownLiteral(after.declaration.default);
    if (was !== now) {
      breaks.add(
        `default|${after.origin}|${name}`,
        after.declaration.at,
        'later',
        `${what} starts at ${now} now, and started at ${was}: a save keeps only what differs from where a thing starts, so one it left at ${was} would read ${now}.`,
        `Start it at ${was} again, ${AGAIN}`,
      );
    }
  }
}

/** Every object among `given` and what each holds, by its giver and its path in the giver's body. */
function everyGivenOf(given: readonly KindContent[]): Map<string, KindContent> {
  const all = new Map<string, KindContent>();
  const walk = (content: KindContent): void => {
    all.set(`${content.giver}|${content.path.join('.')}`, content);
    content.holds.forEach(walk);
  };
  given.forEach(walk);
  return all;
}

/** Every object `contents` gives, by its giver and its path in the giver's body. */
function everyGiven(contents: KindContents): Map<string, KindContent> {
  return everyGivenOf([...contents.values()].flat());
}

/** Whether `catalogue` declares the kind of qualified name `qualified`. */
function declaredIn(catalogue: Catalogue, qualified: string): boolean {
  const [library, ...rest] = qualified.split('.');
  return catalogue.lookup.qualified(library!, rest.join('.')) !== null;
}

/** Where a kind is written, as near as the catalogue says: one of its own properties. */
function whereKind(kind: KindRef): Span | null {
  const name = kindName(kind);
  for (const property of kind.properties.values())
    if (property.origin === name) return property.declaration.at;
  return null;
}

/** Every change from `earlier` to `later` that a save of `earlier` would not survive, in the order the files read. */
export function saveBreaks(earlier: Catalogue, later: Catalogue): SaveBreak[] {
  const breaks = gathering(earlier.world);
  if (earlier.world !== later.world) {
    breaks.add(
      'world',
      null,
      'later',
      `The world is named \`${later.world}\` now, and was \`${earlier.world}\`: everything a save holds is named under the world's name, so no save of it can be read.`,
      `Name it \`${earlier.world}\` again, ${AGAIN}`,
    );
    return breaks.list;
  }

  if (earlier.worldKind !== null && later.worldKind !== null)
    compareProperties(earlier.worldKind, later.worldKind, breaks);
  if (earlier.visitorKind !== null && later.visitorKind !== null)
    compareProperties(earlier.visitorKind, later.visitorKind, breaks);

  const inWorld = (id: string) => id.slice(earlier.world.length + 1);
  for (const [id, before] of earlier.declared) {
    const after = later.declared.get(id);
    if (after === undefined) {
      breaks.add(
        `object|${id}`,
        before.at,
        'earlier',
        `\`${inWorld(id)}\` is not declared there any more: a save keeps a thing by the path it was declared at, so a save that holds anything about it, or anything in it, cannot be read.`,
        `Declare it again under the same name in the same place, ${AGAIN}`,
      );
      continue;
    }
    if (before.alsoIn.length === 0 && after.alsoIn.length > 0) {
      breaks.add(
        `places|${id}`,
        after.at,
        'later',
        `\`${inWorld(id)}\` stands in more than one place now, and was in one: a save may hold it moved, and a thing in several places is never moved, so such a save cannot be read.`,
        `Leave it in one place, ${AGAIN}`,
      );
    }
    if (before.kind !== null && after.kind !== null)
      compareProperties(before.kind, after.kind, breaks);
  }

  for (const [name, before] of earlier.kinds) {
    const after = later.kinds.get(name);
    if (after === undefined) {
      const stays = declaredIn(later, name);
      const kind = breaks.shown(name);
      breaks.add(
        `kind|${name}`,
        whereKind(before),
        'earlier',
        stays
          ? `The kind \`${kind}\` now makes the world or its visitors, so a thing a save holds that was spawned as one cannot be read.`
          : `The kind \`${kind}\` is gone: a save may hold a thing spawned as one, which cannot be read without it.`,
        `Keep \`${kind}\` a kind of thing, under its name, ${AGAIN}`,
      );
      continue;
    }
    compareProperties(before, after, breaks);
  }

  const givenBefore = everyGiven(earlier.contents);
  const givenAfter = everyGiven(later.contents);
  for (const [key, before] of givenBefore) {
    const after = givenAfter.get(key);
    const giver = breaks.shown(before.giver);
    const what = `\`${before.path.join('.')}\`, which every \`${giver}\` is given,`;
    if (after === undefined) {
      breaks.add(
        `given|${key}`,
        before.declaration.at,
        'earlier',
        `${what} is gone: a save that holds one cannot be read.`,
        `Put it back in the body of \`${giver}\` under the same name, ${AGAIN}`,
      );
      continue;
    }
    if (before.kind !== null && after.kind !== null)
      compareProperties(before.kind, after.kind, breaks);
  }
  // What a thing already made of a kind lacks: anything its whole closure gives now that it did not, whether
  // written into a body or gained by composing another kind.
  const made: [KindRef, KindRef][] = [...earlier.kinds]
    .filter(([name]) => later.kinds.has(name))
    .map(([name, kind]) => [kind, later.kinds.get(name)!]);
  if (earlier.visitorKind !== null && later.visitorKind !== null)
    made.push([earlier.visitorKind, later.visitorKind]);
  for (const [before, after] of made) {
    const had = everyGivenOf(givenBy(earlier.contents, before));
    for (const [key, content] of everyGivenOf(givenBy(later.contents, after))) {
      if (had.has(key)) continue;
      const kind = breaks.shown(kindName(after));
      const giver = breaks.shown(content.giver);
      const path = content.path.join('.');
      // New to the body of a giver the earlier build had: the body changed, whichever kind it reaches first.
      if (!givenBefore.has(key) && declaredIn(earlier, content.giver)) {
        breaks.add(
          `added|${key}`,
          content.declaration.at,
          'later',
          `\`${path}\` is new in the body of \`${giver}\`: every \`${giver}\` a save already holds was made without it.`,
          `Leave the body of \`${giver}\` as it was, ${AGAIN}`,
        );
        continue;
      }
      breaks.add(
        `composed|${kind}|${key}`,
        content.declaration.at,
        'later',
        `Every \`${kind}\` is now given \`${path}\` by \`${giver}\`: every \`${kind}\` a save already holds was made without it.`,
        `Leave what \`${kind}\` is made of as it was, ${AGAIN}`,
      );
    }
  }

  return breaks.list
    .map((one, order) => ({ one, order }))
    .sort((a, b) => byPlace(a.one, b.one) || a.order - b.order)
    .map(({ one }) => one);
}

/** Later before earlier, then by file, line and column; a break with no place last. */
function byPlace(a: SaveBreak, b: SaveBreak): number {
  if (a.in !== b.in) return a.in === 'later' ? -1 : 1;
  if (a.at === null || b.at === null) return (a.at === null ? 1 : 0) - (b.at === null ? 1 : 0);
  const file =
    a.at.source.name < b.at.source.name ? -1 : a.at.source.name > b.at.source.name ? 1 : 0;
  if (file !== 0) return file;
  const p = a.at.source.positionAt(a.at.start);
  const q = b.at.source.positionAt(b.at.start);
  return p.line - q.line || p.column - q.column;
}
