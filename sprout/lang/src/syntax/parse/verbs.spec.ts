import { describe, expect, it } from 'vitest';

import type { Declaration } from '../ast.js';
import type { RoleDeclaration, VerbDeclaration } from '../ast-verbs.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { chooser, read } from '../../fixtures/parse.js';
import {
  FOLLOWING,
  nothingVanishes,
  verbMemberNames,
  VERB_MEMBER_DEFECTS,
  WELL_FORMED_VERB_MEMBERS,
} from '../../fixtures/recovery.js';

const verbsOf = (declarations: readonly Declaration[]): VerbDeclaration[] =>
  declarations.filter((d): d is VerbDeclaration => d.kind === 'verb');

/** One verb, read with nothing refused. */
function verb(text: string): VerbDeclaration {
  const { declarations, refusals } = read(text, 'v.sprout');
  expect(refusals, text).toEqual([]);
  const [only] = verbsOf(declarations);
  expect(only, text).toBeDefined();
  return only!;
}

/** A role as a short line: its name, what fills it, and its modifiers. */
function roleShape(role: RoleDeclaration): string {
  const filler =
    role.filler === null
      ? ''
      : role.filler.kind === 'value-filler'
        ? `: ${role.filler.value}`
        : `: ${role.filler.library === null ? '' : `${role.filler.library.text}.`}${role.filler.name.text}`;
  return `${role.name.text}${filler}${role.many === null ? '' : ' many'}${role.optional === null ? '' : ' optional'}`;
}

/** What was said, as `line:column message`. */
function said(text: string): string[] {
  return read(text, 'v.sprout').refusals.map((d) => `${locationOf(d.at)} ${d.message}`);
}

describe('a verb, as the spec and its standard library write them', () => {
  it('reads its roles in order, each with its filler and modifiers, and its phrases', () => {
    const unlock = verb(
      'verb unlock {\n  role target: Lockable\n  role tool\n  "unlock [target] with [tool]"\n  "use [tool] on [target]"\n  "unlock [target]"\n}',
    );
    expect(unlock.name.text).toBe('unlock');
    expect(unlock.roles.map(roleShape)).toEqual(['target: Lockable', 'tool']);
    expect(unlock.phrases.map((p) => p.text)).toEqual([
      'unlock [target] with [tool]',
      'use [tool] on [target]',
      'unlock [target]',
    ]);
    expect(unspanned(unlock)).toEqual([]);
    expect(textOf(unlock.at)).toBe(textOf(unlock.at).trim());
    expect(textOf(unlock.at).endsWith('}')).toBe(true);
  });

  it('reads every filler: a kind, a library’s kind, `symbol`, `integer` and `exit`', () => {
    const shapes = verb(
      'verb v { role a: Container  role b: sprout.Container  role c: symbol  role d: integer  role e: exit }',
    ).roles.map(roleShape);
    expect(shapes).toEqual([
      'a: Container',
      'b: sprout.Container',
      'c: symbol',
      'd: integer',
      'e: exit',
    ]);
  });

  it('reads `many` and `optional` after the filler, in either order', () => {
    expect(
      verb('verb work { role target  role tools: Rib many  "work [target]" }').roles.map(roleShape),
    ).toEqual(['target', 'tools: Rib many']);
    expect(
      verb('verb nuzzle { role target: Creature  role gift optional }').roles.map(roleShape),
    ).toEqual(['target: Creature', 'gift optional']);
  });

  it('reads the standard library’s verbs, on one line or many', () => {
    for (const text of [
      'verb go        { role way: exit  "go [way]"  "[way]"  "walk [way]" }',
      'verb look      { "look"  "l"  "look around" }',
      'verb examine   { role target  "examine [target]"  "x [target]"  "look at [target]"  "inspect [target]" }',
      'verb inventory { "inventory"  "i"  "inv" }',
      'verb wait      { "wait"  "z" }',
      'verb help      { "help"  "?" }',
      'verb put  { role item  role container: Container  "put [item] in [container]"  "put [item] into [container]" }',
      'verb give { role item  role recipient: Actor  "give [item] to [recipient]"  "hand [item] to [recipient]" }',
      'verb ask {\n  role target\n  role topic: symbol\n  "ask [target] about [topic]"\n  "ask [target] [topic]"\n}',
      'verb nuzzle { role target: Creature }',
    ]) {
      expect(unspanned(verb(text)), text).toEqual([]);
    }
  });

  it('takes roles and phrases in any order, and either list may be empty', () => {
    const mixed = verb('verb shout { "shout at [target]"  role target  "yell at [target]" }');
    expect(mixed.roles.map(roleShape)).toEqual(['target']);
    expect(mixed.phrases.map((p) => p.text)).toEqual(['shout at [target]', 'yell at [target]']);
    const empty = verb('verb dance { }');
    expect([empty.roles, empty.phrases]).toEqual([[], []]);
  });

  it('keeps the declarations either side of it', () => {
    const { declarations, refusals } = read(
      'enum Ward { oak }\nverb take { role target  "take [target]" }\nmessage :stir\n',
    );
    expect(refusals).toEqual([]);
    expect(declarations.map((d) => d.kind)).toEqual(['enum', 'verb', 'message']);
  });
});

describe('what the verb reader refuses, at the token', () => {
  it('a verb with no name, at its brace, and the body is still read', () => {
    expect(said('verb { role target  "take [Target]" }')).toEqual([
      'v.sprout:1:6 `verb` needs a name.',
      'v.sprout:1:27 A slot names a role in lower case, and `Target` starts with a capital.',
    ]);
    expect(said('verb\nenum Ward { oak }')).toEqual(['v.sprout:2:1 `verb` needs a name.']);
    expect(read('verb\nenum Ward { oak }').declarations.map((d) => d.kind)).toEqual(['enum']);
  });

  it('a word of the language as its name, and a member’s word in the member’s own terms', () => {
    expect(said('verb move { }')).toEqual([
      'v.sprout:1:6 `move` is a word of the language, so it cannot name a verb.',
    ]);
    for (const word of ['do', 'describe', 'depart', 'release', 'accept', 'permit', 'prose']) {
      expect(said(`verb ${word} { }`), word).toEqual([
        `v.sprout:1:6 \`${word}\` names a member of a kind, so it cannot name a verb.`,
      ]);
    }
  });

  it('a verb called `passage`, whose braces the lexer takes as prose, costs only itself', () => {
    const { declarations, refusals } = read('verb passage { role target }\nenum Ward { oak }');
    expect(refusals.map((d) => d.message)).toEqual([
      '`passage` names a member of a kind, so it cannot name a verb.',
    ]);
    expect(declarations.map((d) => d.kind)).toEqual(['enum']);
  });

  it('a capitalised name, a missing brace, and a verb never closed', () => {
    expect(said('verb Take { }')).toEqual([
      "v.sprout:1:6 A verb's name is a lower-case word, and `Take` starts with a capital.",
    ]);
    expect(said('verb take role target')).toEqual([
      'v.sprout:1:11 The roles and phrases of `take` go in braces.',
    ]);
    expect(said('verb take {\n  role target\nmessage :stir')).toEqual([
      'v.sprout:3:1 `take` is never closed.',
    ]);
    expect(said('verb take {\n  role target')).toEqual(['v.sprout:2:14 `take` is never closed.']);
  });

  it('a role with no name, a word of the language or a capital as one', () => {
    expect(said('verb v { role }')).toEqual(['v.sprout:1:14 `role` needs a name.']);
    expect(said('verb v { role "v" }')).toEqual(['v.sprout:1:14 `role` needs a name.']);
    expect(said('verb v { role exit  "v [exit]" }')).toEqual([
      'v.sprout:1:15 `exit` is a word of the language, so it cannot name a role.',
    ]);
    // Kept under the name the remedy offers, so the phrase is not refused too.
    const capital = read('verb v { role MagicWord  "v [magic_word]" }', 'v.sprout');
    expect(capital.refusals.map((d) => d.remedy)).toEqual([
      'Write `role magic_word`. A kind that fills it comes after a colon: `role target: MagicWord`.',
    ]);
    expect(verbsOf(capital.declarations)[0]!.roles.map(roleShape)).toEqual(['magic_word']);
  });

  it('a filler that is none of a kind, `symbol`, `integer` or nothing', () => {
    for (const word of ['boolean', 'string', 'object', 'topic']) {
      expect(said(`verb v { role target  role t: ${word} }`), word).toEqual([
        `v.sprout:1:31 \`${word}\` cannot fill a role.`,
      ]);
    }
    expect(said('verb v { role t: 4 }')).toEqual([
      'v.sprout:1:18 The number 4 cannot fill a role.',
    ]);
    expect(said('verb v { role t: }')).toEqual([
      'v.sprout:1:17 `t` has a colon and nothing after it to fill the role.',
    ]);
    expect(said('verb v { role t: many }')).toEqual([
      'v.sprout:1:17 `t` has a colon and nothing after it to fill the role.',
    ]);
  });

  it('a filler written against its colon, which the lexer reads as a property', () => {
    const { refusals } = read(
      'verb v { role topic:symbol  role box:sprout.Container }',
      'v.sprout',
    );
    expect(refusals.map((d) => [locationOf(d.at), d.remedy])).toEqual([
      ['v.sprout:1:20', 'Write `role topic: symbol`, with a space after the colon.'],
      ['v.sprout:1:37', 'Write `role box: sprout.Container`, with a space after the colon.'],
    ]);
  });

  it('`many` with `optional`, at `optional` whichever comes first, and a modifier twice', () => {
    const message =
      '`tools` is marked `many` and `optional`, and a set is never optional: a phrase that leaves it out binds the empty set.';
    expect(said('verb v { role tools many optional }')).toEqual([`v.sprout:1:26 ${message}`]);
    expect(said('verb v { role tools optional many }')).toEqual([`v.sprout:1:21 ${message}`]);
    // The role keeps `many`, so nothing downstream reads it as optional.
    const kept = verbsOf(read('verb v { role tools optional many }').declarations)[0]!;
    expect(kept.roles.map(roleShape)).toEqual(['tools many']);
    expect(said('verb v { role tools many many }')).toEqual([
      'v.sprout:1:26 `tools` is marked `many` twice.',
    ]);
  });

  it('a word no member begins with, once, and `from` in the role-player’s terms', () => {
    expect(said('verb v { role t  the thing  "v [t]" }')).toEqual([
      'v.sprout:1:18 A verb is not made of `the`.',
    ]);
    expect(said('verb ask { role topic: symbol from :knows }')).toEqual([
      "v.sprout:1:31 A verb does not say where a role's options come from.",
    ]);
  });
});

describe('a defect in one member of a verb costs that member, not the verb', () => {
  it('keeps every well-formed member, whichever member is defective and wherever it stands', () => {
    const c = chooser(20_260_923);
    const used = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const good = c
        .shuffled(WELL_FORMED_VERB_MEMBERS)
        .slice(0, 1 + c.below(WELL_FORMED_VERB_MEMBERS.length));
      const defect = c.one(VERB_MEMBER_DEFECTS);
      used.add(defect);
      const members: string[] = good.map((m) => m.text);
      members.splice(c.below(members.length + 1), 0, defect);
      const text = `verb v {\n  ${members.join(c.one(['\n  ', '  ']))}\n}\nenum Omega { y }\n`;
      const { declarations, refusals } = read(text, 'v.sprout');
      expect(refusals.length, `${text}\n  nothing was wrong with it`).toBeGreaterThan(0);
      expect(
        declarations.map((d) => d.name.text),
        text,
      ).toEqual(['v', 'Omega']);
      const kept = verbMemberNames(verbsOf(declarations)[0]!);
      const written = [...good.map((m) => m.name), ...kept.filter((k) => /faulty|exit/.test(k))];
      expect(
        nothingVanishes(
          text,
          kept,
          good.map((m) => m.name),
          written,
        ),
      ).toEqual([]);
    }
    expect([...used].sort()).toEqual([...VERB_MEMBER_DEFECTS].sort());
  });

  it('says a verb is never closed and keeps whatever declaration follows it', () => {
    for (const following of FOLLOWING) {
      const text = `verb faulty {\n  role alpha\n  "go [alpha]"\n${following.text}\n`;
      const { declarations, refusals } = read(text, 'v.sprout');
      expect(
        refusals.map((d) => d.message),
        text,
      ).toContain('`faulty` is never closed.');
      const from = text.indexOf(following.text);
      const kept = declarations.some((d) => d.name.text === following.name);
      const refusedInIt = refusals.some(
        (d) => d.at.start >= from && d.message !== '`faulty` is never closed.',
      );
      expect(kept || (!following.wellFormed && refusedInIt), text).toBe(true);
      expect(verbMemberNames(verbsOf(declarations)[0]!), text).toEqual([
        'role alpha',
        'phrase go [alpha]',
      ]);
    }
  });
});
