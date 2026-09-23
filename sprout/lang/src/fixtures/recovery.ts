// Shared machinery behind the parser's recovery invariant — "a defect in
// one item never loses a well-formed neighbour in silence" — that
// syntax/parse/recovery/*.spec.ts runs over `:remembers`, properties,
// list defaults, bodies and whole files. Spec support: the package build
// leaves it out. It holds no `describe`, and, per boundary.spec.ts, a
// non-spec file under src/ may not import vitest, so every check here
// returns a list of findings (empty means the rule held) and the calling
// spec `expect`s it.

import {
  writtenMember,
  type Declaration,
  type KindDeclaration,
  type ObjectDeclaration,
  type WorldDeclaration,
  type WorldMember,
} from '../syntax/ast.js';
import type { VerbDeclaration } from '../syntax/ast-verbs.js';
import { Diagnostics, type Diagnostic } from '../source/diagnostics.js';
import { DEEPEST } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';
import type { Chooser } from './parse.js';

/** A construct nested one level past the parser's own depth bound, `DEEPEST`. */
export const tooDeep = (inner: string) => '['.repeat(DEEPEST + 1) + inner + ']'.repeat(DEEPEST + 1);

/**
 * What holds a body of members, as each is opened and closed. A world, a
 * kind and an object read their bodies through one reader, and every run
 * over this list therefore tests a change to it for all three. An object
 * is written in the body of what holds it, so it opens inside a world
 * and closes both.
 */
export const OWNERS = [
  { kind: 'world', name: 'w', open: 'world w is sprout.World {', close: '}' },
  { kind: 'kind', name: 'K', open: 'kind K {', close: '}' },
  { kind: 'object', name: 'o', open: 'world w is sprout.World {\nobject o is K {', close: '}\n}' },
] as const;
export type Owner = (typeof OWNERS)[number];

/** The declaration an owner opened, among what a file read: an object, in its world's body. */
export const ownedBy = (
  owner: Owner,
  declared: readonly Declaration[],
): WorldDeclaration | KindDeclaration | ObjectDeclaration | undefined => {
  if (owner.kind !== 'object') {
    return declared.find((d): d is WorldDeclaration | KindDeclaration => d.kind === owner.kind);
  }
  const world = declared.find((d): d is WorldDeclaration => d.kind === 'world');
  return world?.objects.find((object) => object.name.text === owner.name);
};

/**
 * What the body around an owner holds of its own: for an object, the
 * world's members and the objects beside it. A stray `}` in an object's
 * body closes it, and what was written after that is read by the world
 * around it, where it is kept rather than lost.
 */
export const aroundOwner = (owner: Owner, declared: readonly Declaration[]): string[] => {
  if (owner.kind !== 'object') return [];
  const world = declared.find((d): d is WorldDeclaration => d.kind === 'world');
  if (world === undefined) return [];
  return [
    ...world.members.flatMap(memberNames),
    ...world.objects.filter((o) => o.name.text !== owner.name).map((o) => `object.${o.name.text}`),
  ];
};

/**
 * A world member by what it would be looked up as, a `:remembers` by each
 * entry, a guard by its word, a play by its head.
 */
export const memberNames = (member: WorldMember): string[] =>
  member.kind === 'property'
    ? [member.name.text]
    : member.kind === 'remembers'
      ? member.properties.map((p) => `remembers.${p.name.text}`)
      : member.kind === 'guard'
        ? [member.guard]
        : member.kind === 'play'
          ? [writtenMember(member.head)]
          : [member.kind];

/**
 * The three guards, written well, each with a block that holds a block:
 * the spec's own `sprout.Actor` guards and `sprout.Container`'s `accept`.
 */
export const WELL_FORMED_GUARDS = [
  { names: ['depart'], text: 'depart (to) { if (mover != self) { refuse held_fast } }' },
  {
    names: ['release'],
    text: 'release (item, to) {\n    if (mover != self) { refuse "That is not yours." }\n    else { allow }\n  }',
  },
  {
    names: ['accept'],
    text: 'accept (item, from) {\n    if (!self.get(:open)) { refuse shut }\n    else if (self.count >= self.get(:capacity)) { refuse full }\n  }',
  },
] as const;

/**
 * A guard with one defect in it: its parameters, its braces, or one of
 * its statements. Each costs the guard at most, and never a neighbour.
 */
export const GUARD_DEFECTS: readonly string[] = [
  'depart',
  'depart (to)',
  'depart { allow }',
  'depart (To) { allow }',
  'depart (to,) { allow }',
  'depart (to { allow }',
  'release (item) { allow }',
  'accept (item, from, extra) { allow }',
  'release (item, if) { allow }',
  'depart (to) { refuse }',
  'depart (to) { refuse 4 }',
  'depart (to) { if self.open { allow } }',
  'depart (to) { if () { allow } }',
  'depart (to) { if (a) allow }',
  'depart (to) { else { allow } }',
  'depart (to) { if (a) { allow } else }',
  'accept (item, from) { tell "Hello." }',
  'accept (item, from) { if (a) { allow } %% allow }',
];

/**
 * A guard whose block is never closed. Before another member it is said
 * there and the member is kept; last in the body, it takes the body's
 * own `}`, and the body is never closed.
 */
export const GUARD_UNCLOSED = 'depart (to) { if (a) { allow }';

/**
 * Every well-formed thing is KEPT.
 *
 * Kept, not merely "named in something said": a name is "named" by any
 * refusal that happens to quote it, so a declaration that vanished
 * entirely would pass if whatever swallowed it complained about its name
 * on the way past. And kept HERE: a declaration written inside a world,
 * reparsed as a sibling of the world that held it, is not kept.
 *
 * So: kept, and nothing else appears that was not written at this level.
 * A defect that genuinely takes a neighbour with it is named in its
 * table rather than covered by a weaker rule. Returns one finding per
 * violation; an empty array means the rule held.
 */
export function nothingVanishes(
  what: string,
  kept: readonly string[],
  good: readonly string[],
  written: readonly string[] = good,
): string[] {
  const findings: string[] = [];
  for (const name of good) {
    if (!kept.includes(name)) findings.push(`${what}: \`${name}\` vanished`);
  }
  for (const name of kept) {
    if (!written.includes(name)) {
      findings.push(`${what}: \`${name}\` appeared where it was not written`);
    }
  }
  return findings;
}

// --- the same rule, over generated input -----------------------------
//
// What follows builds a well-formed item from its parts, with a fixed
// seed chosen by each spec, and puts one defect into any one part of it,
// so the net reaches shapes nobody thought to write down.
//
// A defect is one of three sorts, and the rule is as strong as each
// allows. Most are self-contained, and every well-formed item is KEPT. A
// stray closer really does end what it closes, so an item after it may
// instead be NAMED in something said. An unclosed bracket really does
// take what follows it, as far as whichever closer turns up, so it is
// held only to the rest of the rule, which binds all three: nothing
// appears that was not written, nothing is thrown, and the defect is
// refused, which keeps the net from passing vacuously.

export type Sort = 'contained' | 'stray' | 'unclosed';

/** One defect as written. */
export interface Defect {
  readonly text: string;
  readonly sort: Sort;
}
export const contained = (text: string): Defect => ({ text, sort: 'contained' });
export const stray = (text: string): Defect => ({ text, sort: 'stray' });
export const unclosed = (text: string): Defect => ({ text, sort: 'unclosed' });

/** Sorted defects generated so far, so a sort a run never reached is a failure. */
export function tally() {
  const seen = new Map<string, number>();
  return {
    add: (key: string) => seen.set(key, (seen.get(key) ?? 0) + 1),
    keys: () => [...seen.keys()].sort(),
  };
}

export const SORTS = ['contained', 'stray', 'unclosed'];

/** A number over the cap a list default's `caps.maxListLength` allows. */
export const OVER_CAP = `[${Array.from({ length: 17 }, (_, i) => i).join(', ')}]`;

/** What a written property is made of after its name. */
export type Role = 'type' | 'default' | 'value' | 'bound';
export interface Part {
  readonly role: Role;
  readonly text: string;
}

/**
 * A well-formed property's parts: a written type and `default`, or a
 * bare value; a number, a truth value, text, an option or a list nested
 * up to three deep; and on a number, a `min` and a `max` in either
 * order, or one, or neither.
 */
export function wellFormedParts(c: Chooser): Part[] {
  const int = (): string => `${c.below(3) === 0 ? '-' : ''}${c.below(100)}`;
  const nested = (depth: number, leaf: () => string): string => {
    const count = depth > 1 ? 1 + c.below(2) : c.below(4);
    const inner = (): string => (depth > 1 ? nested(depth - 1, leaf) : leaf());
    return `[${Array.from({ length: count }, inner).join(', ')}]`;
  };
  const bare = (value: string): Part[] => [{ role: 'value', text: value }];
  const typed = (type: string, value: string): Part[] => [
    { role: 'type', text: type },
    { role: 'default', text: 'default' },
    { role: 'value', text: value },
  ];
  const depth = 1 + c.below(3);
  const listOf = (element: string): string => `${'['.repeat(depth)}${element}${']'.repeat(depth)}`;
  const shapes: (() => Part[])[] = [
    () => bare(int()),
    () => typed('integer', int()),
    () => bare(c.one(['true', 'false'])),
    () => typed('boolean', c.one(['true', 'false'])),
    () => bare('"a line"'),
    () => typed('string', '"a line"'),
    () => bare('oak'),
    () => typed(c.one(['Ward', 'sprout.Ward']), 'oak'),
    () => bare(c.one(['Ward.oak', 'sprout.Ward.oak'])),
    () =>
      typed(
        listOf('Ward'),
        nested(depth, () => c.one(['oak', 'silver'])),
      ),
    () => typed(listOf('integer'), nested(depth, int)),
    () => bare(nested(depth, int)),
  ];
  const parts = c.one(shapes)();
  if (/^-?\d+$/.test(parts.at(-1)!.text)) {
    const bounds = [`min ${int()}`, `max ${int()}`].filter(() => c.below(2) === 0);
    if (c.below(2) === 0) bounds.reverse();
    parts.push(...bounds.map((text) => ({ role: 'bound' as const, text })));
  }
  return parts;
}

/**
 * What a defect in each part may be: between them, every sort the net is
 * for — a wrong token, a missing one, a reserved word, a capitalised
 * word, a fraction, a nest too deep, a list over the cap, a bad bound, a
 * stray closer and an unclosed bracket.
 */
export const PART_DEFECTS: Record<Exclude<Role, 'bound'>, readonly Defect[]> = {
  type: [
    contained('%'),
    contained('integer.3'),
    contained('sprout.'),
    contained('[Ward, oak]'),
    contained(tooDeep('Ward')),
    unclosed('[Ward'),
  ],
  default: [contained(''), contained('defualt')],
  value: [
    contained(''),
    contained('1.5'),
    contained('-1.5'),
    contained('%'),
    contained(':wet'),
    contained('{}'),
    contained('Zeta'),
    contained('-oak'),
    contained('-[1]'),
    contained('-'),
    contained('Ward.Iron'),
    contained(tooDeep('1')),
    contained(OVER_CAP),
    contained('[oak silver]'),
    contained('[oak, [silver, Zeta]]'),
    // Not `message :stir` or `enum Ward { oak }`: a reserved word that
    // completes its declaration's opening is no longer a defect
    // contained in this value — the property reader takes it for a
    // missing value with a declaration written after it, which is not a
    // loss and has its own coverage: `[oak, enum]` in world.spec.ts for
    // a reserved word that stands as a value, and the generated body run
    // in bodies.spec.ts, through `following`, for one that opens a real
    // declaration. A capitalised word in the same spot is still refused
    // everywhere it can stand, so it keeps that coverage.
    contained('Ward'),
    contained('Drying'),
    unclosed('[oak'),
  ],
};

/** What may stand after a `min` or a `max` and is not a whole number. */
export const BAD_BOUNDS: readonly Defect[] = [
  ...['[1]', '-[1]', '-[1, 2]', '[[1]]', 'oak', '-oak', 'Ward', '"9"', 'true', ':wet'].map((text) =>
    contained(text),
  ),
  ...['1.5', '-1.5', '-', '', '- -', tooDeep('1'), OVER_CAP].map((text) => contained(text)),
  stray(']'),
  unclosed('[1'),
];

/**
 * A bound left with nothing of its own after it — `min`, `max -`, `max
 * - -` — the shape `skipValue` must stop at whatever stands right after
 * it for. A body's generated run draws this often, rather than leaving
 * it to however rarely a plain `BAD_BOUNDS` draw lands here, so a
 * next declaration's own word placed directly against it is reached.
 */
export const BOUND_LEAVES_NOTHING_AFTER: readonly Defect[] = [
  contained(''),
  contained('-'),
  contained('- -'),
];

/** `:faulty 0 max - -` — a member whose bound leaves nothing of its own behind it. */
export function boundLeavingNothingAfter(c: Chooser): { text: string; defect: Defect } {
  const which = c.one(['min', 'max']);
  const defect = c.one(BOUND_LEAVES_NOTHING_AFTER);
  const bound = `${which} ${defect.text}`.trim();
  return { text: spelled('faulty', 'member', ['0', bound]), defect };
}

/** Between any two parts: something that closes or opens and should not. */
export const BETWEEN: readonly Defect[] = [stray(']'), stray('}'), contained(')'), unclosed('[')];

/** How a defect in a name is written, as a `:remembers` entry and as a property. */
export const NAME_DEFECTS: Record<'entry' | 'member', readonly string[]> = {
  entry: ['Zeta:', '4:', ':', 'faulty', '"faulty":', 'faulty::'],
  member: [':Zeta', 'faulty', '"faulty"', '::faulty', ': faulty'],
};

/** A property as written, the name first in the form its place asks for. */
export const spelled = (name: string, form: 'entry' | 'member', parts: readonly string[]): string =>
  [form === 'entry' ? `${name}:` : `:${name}`, ...parts].filter((t) => t !== '').join(' ');

export const wellFormed = (c: Chooser, name: string, form: 'entry' | 'member'): string =>
  spelled(
    name,
    form,
    wellFormedParts(c).map((part) => part.text),
  );

/**
 * A property called `faulty` with one defect in one part: its name, its
 * type, its `default`, its value, a bound, or between two parts.
 */
export function defectiveProperty(
  c: Chooser,
  form: 'entry' | 'member',
): { text: string; defect: Defect } {
  const parts = wellFormedParts(c);
  const texts = parts.map((part) => part.text);
  const roll = c.below(10);
  if (roll === 0) {
    const text = [c.one(NAME_DEFECTS[form]), ...texts].join(' ');
    return { text, defect: contained('') };
  }
  if (roll <= 3) {
    // A bad bound, in place of one written or added to any value, or a
    // bound written twice.
    const which = c.one(['min', 'max']);
    const defect = c.below(6) === 0 ? contained(`0 ${which} 1`) : c.one(BAD_BOUNDS);
    const bound = `${which} ${defect.text}`.trim();
    const at = parts.findIndex((part) => part.role === 'bound');
    if (at >= 0 && c.below(2) === 0) texts[at] = bound;
    else texts.push(bound);
    return { text: spelled('faulty', form, texts), defect };
  }
  if (roll <= 5) {
    const defect = c.one(BETWEEN);
    const at = c.below(texts.length + 1);
    texts.splice(at, 0, defect.text);
    return { text: spelled('faulty', form, texts), defect };
  }
  const at = c.below(parts.filter((part) => part.role !== 'bound').length);
  const defect = c.one(PART_DEFECTS[parts[at]!.role as Exclude<Role, 'bound'>]);
  texts[at] = defect.text;
  return { text: spelled('faulty', form, texts), defect };
}

/**
 * A colonless entry's value: a number, a string or a list, each standing
 * where the colon should be, and none a bare word. Two bare words in a
 * row are the shape of a member's own start, and are told apart already.
 */
const COLONLESS_VALUES: readonly string[] = ['-19', '"a line"', '[oak, silver]'];

/**
 * `faulty "a line"` — a `:remembers` entry with no colon at all between
 * its name and its value, the shape a list default's own recovery
 * (`elementsAfterClose` in `types.ts`) must tell apart from more of a
 * list's own elements.
 */
const colonlessEntry = (c: Chooser): { text: string; defect: Defect } => ({
  text: `faulty ${c.one(COLONLESS_VALUES)}`,
  defect: contained(''),
});

/** A well-formed entry whose default is a plain list, unconditionally. */
const listEntry = (name: string): string => `${name}: [oak, silver]`;

/**
 * One `:remembers` of well-formed entries and one defective one, in any
 * order. A colonless entry beside a list default is built directly, now
 * and then, since that pairing falls together by chance only rarely.
 */
export function generatedRemembers(c: Chooser, names: readonly string[]) {
  let faulty = c.below(names.length + 1);
  const entries = names.map((name) => wellFormed(c, name, 'entry'));
  // A missing or doubled comma after a well-formed entry is a defect of
  // its own, and changes nothing about what must be kept.
  const inSeparator = faulty < names.length && c.below(8) === 0;
  let made = inSeparator
    ? { text: wellFormed(c, 'faulty', 'entry'), defect: contained('') }
    : defectiveProperty(c, 'entry');
  // Built directly on one side or the other, in place of whatever
  // `defectiveProperty` rolled, since a list shape for the neighbour and
  // a colonless name for the defect seldom fall together by chance.
  if (!inSeparator && names.length > 0 && c.below(4) === 0) {
    made = colonlessEntry(c);
    if (c.below(2) === 0) {
      // Before: the colonless entry is read first and refused at its
      // own missing colon, and recovery must step past its value's own
      // brackets rather than the list default's, which stands right
      // after it.
      faulty = 0;
      entries[0] = listEntry(names[0]!);
    } else {
      // After: the list default's own close is genuine, and nothing
      // well-formed stands between the colonless entry and `:remembers`'s
      // own `]`, so that closer is the one the scan must leave alone.
      faulty = entries.length;
      entries[entries.length - 1] = listEntry(names[entries.length - 1]!);
    }
  }
  entries.splice(faulty, 0, made.text);
  const body = inSeparator
    ? `${entries.slice(0, faulty + 1).join(', ')}${c.one([' ', ', , '])}${entries.slice(faulty + 1).join(', ')}`
    : entries.join(', ');
  return { ...made, text: `:remembers [${body}]` };
}

/** One defective world member, of any kind a world holds, or text between two members. */
export function defectiveMember(c: Chooser): { text: string; defect: Defect } {
  const roll = c.below(12);
  if (roll <= 3) return defectiveProperty(c, 'member');
  if (roll <= 5) return generatedRemembers(c, ['echo']);
  if (roll === 6) {
    const text = c.one([
      'visitors are 4',
      'visitors arrive y',
      'visitors',
      'visitors are',
      'contains 4',
      'nonsense',
      '4',
      'without',
      'without accept',
      'without accept from 4',
      'without nonsense from K',
      'without changed',
      'passage',
      'passage Hello { Hi. }',
      'passage hello extra { Hi. }',
      'passage hello',
      'without passage hello',
      'object',
      'object 4',
      'object Faulty is Crate',
      'object faulty is',
      'object faulty is 4',
      'object faulty: Crate',
      'object faulty is Crate in yard',
      'object faulty is Crate { nonsense }',
    ]);
    return { text, defect: contained(text) };
  }
  if (roll === 11 && c.below(2) === 0) {
    if (c.below(6) === 0) return { text: GUARD_UNCLOSED, defect: unclosed(GUARD_UNCLOSED) };
    const text = c.one(GUARD_DEFECTS);
    return { text, defect: contained(text) };
  }
  if (roll === 7) {
    // A property with no value, immediately before the body's own `}`:
    // that `}` is refused as `faulty`'s value, and is not the body's to
    // take — the well-formed members that stand before the real one
    // must still be read, not merely named as displaced.
    const text = ':faulty }';
    return { text, defect: contained(text) };
  }
  if (roll === 8) return boundLeavingNothingAfter(c);
  if (roll === 9) {
    // A list default with no `]` anywhere, immediately before the body's
    // own `}` or the next member: the hunt for its close stops at
    // either rather than reading past them, so the neighbour that
    // follows is always kept (`bodies.spec.ts` checks this directly,
    // beyond what `unclosed`'s own weaker rule requires).
    const text = ':faulty [oak';
    return { text, defect: unclosed(text) };
  }
  if (roll === 10) {
    // The same for a `:remembers` with no `]` anywhere.
    const text = ':remembers [faulty: 0';
    return { text, defect: unclosed(text) };
  }
  // A word that starts a declaration ends the world as never closed, and
  // what follows is the file's: see `FOLLOWING` and `closedByWhatFollows`.
  if (c.below(4) === 0) return { text: 'enum', defect: unclosed('enum') };
  const defect = c.one([stray(']'), contained(')'), unclosed('[')]);
  return { text: defect.text, defect };
}

/**
 * What may follow a body that was never closed: declarations written
 * well, which are kept, and ones whose own header reads like the entries
 * of a `:remembers` — `, name: 1]` — which are kept or refused at their
 * own text, and never taken for the body's.
 */
export const FOLLOWING = [
  { name: 'Omega', text: 'enum Omega { y }', wellFormed: true },
  { name: 'omega', text: 'message :omega', wellFormed: true },
  { name: 'omega', text: 'world omega is sprout.World {\n  visitors are P\n}', wellFormed: true },
  { name: 'Omega', text: 'kind Omega is sprout.Container {\n  contains\n}', wellFormed: true },
  { name: 'Omega', text: 'kind Omega is sprout.Container, name: 1] { }', wellFormed: false },
  {
    name: 'omega',
    text: 'world omega is sprout.World, name: 1] {\n  visitors are P\n}',
    wellFormed: false,
  },
  { name: 'Omega', text: 'enum Omega, name: [1]] { y }', wellFormed: false },
  { name: 'omega', text: 'verb omega {\n  role target\n  "omega [target]"\n}', wellFormed: true },
  { name: 'omega', text: 'verb omega, name: 1] { }', wellFormed: false },
] as const;

/**
 * A world never closed says so, and the declaration after it is its own:
 * kept, or refused somewhere in its own text by something other than the
 * world's refusal. Returns one finding per violation.
 */
export function closedByWhatFollows(
  text: string,
  world: string,
  following: (typeof FOLLOWING)[number],
  declared: readonly Declaration[],
  said: readonly Diagnostic[],
): string[] {
  const findings: string[] = [];
  const unclosedMessage = `\`${world}\` is never closed.`;
  if (!said.some((d) => d.message === unclosedMessage)) {
    findings.push(`${text}\n  nothing says \`${world}\` is never closed`);
  }
  const kept = declared.some((d) => d.name.text === following.name);
  const from = text.lastIndexOf(following.text);
  const refused = said.some((d) => d.at.start >= from && d.message !== unclosedMessage);
  if (!(kept || (!following.wellFormed && refused))) {
    findings.push(`${text}\n  \`${following.name}\` vanished, and nothing in it was refused`);
  }
  return findings;
}

/**
 * The rule, at the strength the defect's sort allows. `good` were
 * written well formed; `written` is every name the source holds at this
 * level, the defective item's included. `refusable` is false only where
 * a reader read on its own stopped before the end, since the text after
 * what it reads is not its to refuse. Returns one finding per violation.
 */
export function explained(
  text: string,
  sort: Sort,
  kept: readonly string[],
  good: readonly string[],
  written: readonly string[],
  said: readonly Diagnostic[],
  refusable = true,
): string[] {
  const findings: string[] = [];
  if (refusable && said.length === 0) {
    findings.push(`${text}\n  nothing was wrong with it`);
  }
  if (sort === 'contained') {
    findings.push(...nothingVanishes(text, kept, [...good], [...written]));
    return findings;
  }
  if (sort === 'stray') {
    for (const name of good) {
      // As said: `remembers.walks` is said as `walks`, a property as it
      // was written, `:bravo`, and a word-led member by its first word,
      // `visitors-arrive-at` as `visitors`.
      const word = name.includes('.')
        ? name.split('.').at(-1)!
        : /^[a-z]+(?:-[a-z]+)+$/.test(name)
          ? name.split('-')[0]!
          : name;
      const named = said.some(
        (d) => d.message.includes(`\`${word}\``) || d.message.includes(`\`:${word}\``),
      );
      if (!(kept.includes(name) || named)) {
        findings.push(`${text}\n  \`${name}\` vanished, and nothing said names it`);
      }
    }
  }
  findings.push(...nothingVanishes(text, kept, [], [...written]));
  return findings;
}

/** Whether a reader read on its own stopped short of the end of what it was given. */
export const stoppedShort = (
  text: string,
  read: { at: { end: number } } | null | undefined,
): boolean => read !== null && read !== undefined && read.at.end < text.trimEnd().length;

/** Runs one reader, and reports if it threw rather than refusing. */
export function reading<T>(text: string, read: (s: SourceFile, d: Diagnostics) => T) {
  const diagnostics = new Diagnostics();
  let result: T | undefined;
  let threw: string | null = null;
  try {
    result = read(new SourceFile('g.sprout', text), diagnostics);
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  return { result: result as T, said: diagnostics.refusals as readonly Diagnostic[], threw };
}

// --- verbs ------------------------------------------------------------

/**
 * A verb's members, written well: roles open, by kind and by value, set
 * and optional, and phrases with escapes in them. Each is named as
 * `verbMemberNames` names what the reader kept.
 */
export const WELL_FORMED_VERB_MEMBERS = [
  { name: 'role alpha', text: 'role alpha' },
  { name: 'role bravo', text: 'role bravo: Crate' },
  { name: 'role charlie', text: 'role charlie: sprout.Container many' },
  { name: 'role delta', text: 'role delta: symbol' },
  { name: 'role echo', text: 'role echo: integer optional' },
  { name: 'phrase go [alpha]', text: '"go [alpha]"' },
  { name: 'phrase use [bravo] on [alpha]', text: '"use [bravo] on [alpha]"' },
  { name: 'phrase say "hi" to [alpha]', text: '"say \\"hi\\" to [alpha]"' },
] as const;

/**
 * A verb's member with one defect in it: a role's name, filler or
 * modifiers, a phrase's slot, or a word no member begins with. Every one
 * says `faulty` or `exit` where it names anything, so what a reader
 * keeps of it can be told from what was written well.
 */
export const VERB_MEMBER_DEFECTS: readonly string[] = [
  'role',
  'role Faulty',
  'role exit',
  'role faulty: boolean',
  'role faulty:symbol',
  'role faulty:',
  'role faulty: 4',
  'role faulty: sprout.',
  'role faulty: [',
  'role faulty many many',
  'role faulty many optional',
  'role faulty: % Crate',
  '"faulty [target"',
  '"faulty []"',
  '"faulty [Target]"',
  '"faulty ] now"',
  '"faulty [a b]"',
  'from :faulty',
  'faulty',
  '4',
  ':faulty',
  '{ faulty }',
  '[faulty]',
  'Faulty',
];

/** What a verb kept, a role by its name and a phrase by what it means. */
export const verbMemberNames = (verb: VerbDeclaration): string[] => [
  ...verb.roles.map((role) => `role ${role.name.text}`),
  ...verb.phrases.map((phrase) => `phrase ${phrase.text}`),
];
