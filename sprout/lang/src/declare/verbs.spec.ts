import { describe, expect, it } from 'vitest';

import type { VerbDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';
import type { OnUnknown } from './compose.js';
import { EnumTable } from './enums.js';
import { KindTable, kindName } from './kinds.js';
import {
  checkVerbDeclaration,
  ENGINE_VERBS,
  VerbTable,
  type ResolvedRole,
  type ResolvedVerb,
  type VerbCaps,
} from './verbs.js';

/** The host's figures, so no suite here writes a number of its own. */
const CAPS: VerbCaps = DEFAULT_LIMITS.caps;

/** A verb as the parser builds it, read with nothing refused. */
function declared(text: string): VerbDeclaration {
  const diagnostics = new Diagnostics();
  const [first] = parseDeclarations(new SourceFile('v.sprout', text), diagnostics);
  expect(diagnostics.refusals, text).toEqual([]);
  return first as VerbDeclaration;
}

/** What the first tier says about one verb, as `line:column message`. */
function checked(text: string, caps: VerbCaps = CAPS): string[] {
  const diagnostics = new Diagnostics();
  checkVerbDeclaration(declared(text), caps, diagnostics);
  return diagnostics.refusals.map((d) => `${locationOf(d.at)} ${d.message}`);
}

/** The remedies, for the cases where what to write instead is the point. */
function remedies(text: string, caps: VerbCaps = CAPS): (string | undefined)[] {
  const diagnostics = new Diagnostics();
  checkVerbDeclaration(declared(text), caps, diagnostics);
  return diagnostics.refusals.map((d) => d.remedy);
}

describe('a verb whose roles and phrases agree says nothing', () => {
  it('over every form the spec and its standard library write', () => {
    for (const text of [
      'verb unlock { role target: Lockable  role tool  "unlock [target] with [tool]"  "use [tool] on [target]"  "unlock [target]" }',
      'verb work { role target  role tools many  "work [target]"  "work [target] with [tools]"  "pull [target]" }',
      'verb throw { role target  role tools: Rib many  "throw [target] using [tools]" }',
      'verb ask { role target  role topic: symbol  "ask [target] about [topic]"  "ask [target] [topic]" }',
      'verb dial { role target  role setting: integer  "set [target] to [setting]" }',
      'verb go { role way: exit  "go [way]"  "[way]"  "walk [way]" }',
      'verb look { "look"  "l"  "look around" }',
      'verb nuzzle { role target: Creature }',
      'verb nudge { role target  role tool optional  role topic: symbol optional }',
      'verb dance { }',
      // `many` on the target: the spec restricts it on value roles only.
      'verb sort { role targets many  "sort [targets]" }',
    ]) {
      expect(checked(text), text).toEqual([]);
    }
  });
});

describe('what a verb must agree with itself about, refused at the thing', () => {
  it('a role declared twice, at the second', () => {
    expect(
      checked('verb give { role item  role recipient  role item  "give [item] to [recipient]" }'),
    ).toEqual(['v.sprout:1:45 `give` declares the role `item` twice.']);
  });

  it('a slot naming a role the verb lacks, with the role it most likely meant', () => {
    const one = 'verb take { role target  "take [thing]" }';
    expect(checked(one)).toEqual([
      'v.sprout:1:32 `"take [thing]"` names `thing`, and `take` has no such role.',
    ]);
    expect(remedies(one)).toEqual(['Its role is `target`. Write `[target]`, or add `role thing`.']);
    // Close enough to be a slip, it is offered; otherwise none is.
    expect(
      remedies('verb give { role item  role recipient  "give [item] to [recipeint]" }'),
    ).toEqual([
      'Its roles are `item` and `recipient`. Write `[recipient]`, or add `role recipeint`.',
    ]);
    expect(remedies('verb give { role item  role recipient  "give [item] to [person]" }')).toEqual([
      'Its roles are `item` and `recipient`. Name one of them, or add `role person`.',
    ]);
    expect(checked('verb wave { "wave at [target]" }')).toEqual([
      'v.sprout:1:22 `"wave at [target]"` names `target`, and `wave` has no roles.',
    ]);
  });

  it('does not also say a phrase leaves out the target where its slot named a role the verb lacks', () => {
    expect(checked('verb take { role target  "take [thing]" }')).toHaveLength(1);
  });

  it('a slot filling one role twice, at the second slot', () => {
    expect(checked('verb give { role item  role recipient  "give [item] to [item]" }')).toEqual([
      'v.sprout:1:56 `"give [item] to [item]"` fills `item` twice.',
    ]);
  });

  it('a phrase written twice, told by what it means rather than its spacing', () => {
    expect(checked('verb take { role target  "take [target]"  "take   [target] "  }')).toEqual([
      'v.sprout:1:43 `take` has the phrase `"take   [target] "` twice.',
    ]);
    // The same words around different slots are different phrases.
    expect(
      checked('verb give { role item  role other  "give [item] [other]"  "give [other] [item]" }'),
    ).toEqual([]);
  });

  it('a phrase with no words in it', () => {
    expect(checked('verb take { role target  "take [target]"  ""  "  " }')).toEqual([
      'v.sprout:1:43 `take` has a phrase with no words in it.',
      'v.sprout:1:47 `take` has a phrase with no words in it.',
    ]);
  });

  it('a phrase that leaves out the target, which every phrase names', () => {
    const text =
      'verb shove { role target  role tool  "shove [target] with [tool]"  "shove"  "use [tool]" }';
    expect(checked(text)).toEqual([
      'v.sprout:1:68 `"shove"` leaves out `target`, the role `shove` is done to.',
      'v.sprout:1:77 `"use [tool]"` leaves out `target`, the role `shove` is done to.',
    ]);
    expect(remedies(text)[0]).toBe(
      'Every phrase names the first role, as `"shove [target]"` does.',
    );
  });

  it('`many` on a value role, at `many`', () => {
    expect(
      checked('verb ask { role target  role topic: symbol many  "ask [target] about [topic]" }'),
    ).toEqual(['v.sprout:1:44 `topic` is a `symbol` role, and a value role is single.']);
    expect(checked('verb dial { role target  role n: integer many }')).toEqual([
      'v.sprout:1:42 `n` is an `integer` role, and a value role is single.',
    ]);
  });

  it('`optional` on a verb with phrases, which decide, and on the target of one without', () => {
    expect(
      checked('verb unlock { role target  role tool optional  "unlock [target] with [tool]" }'),
    ).toEqual([
      'v.sprout:1:38 `tool` is marked `optional`, and `unlock` has phrases, so its phrases decide.',
    ]);
    expect(checked('verb nuzzle { role target optional  role gift optional }')).toEqual([
      'v.sprout:1:27 `target` is the role `nuzzle` is done to, and the target is never optional.',
    ]);
  });
});

describe('the caps that bound a verb are the host’s', () => {
  const roles = (n: number) => Array.from({ length: n }, (_, i) => `role r${i}`).join('  ');
  const phrases = (n: number) => Array.from({ length: n }, (_, i) => `"w${i} [r0]"`).join('  ');

  it('refuses the first role past the cap, once, and none at the cap', () => {
    const at = CAPS.rolesPerVerb;
    expect(checked(`verb v { ${roles(at)} }`)).toEqual([]);
    const said = checked(`verb v { ${roles(at + 2)} }`);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(
      `\`v\` has ${at + 2} roles, and ${at} is as many as a verb may have.`,
    );
    expect(said[0]).toMatch(new RegExp(`^v\\.sprout:1:${10 + at * `role rN  `.length}`));
  });

  it('refuses the first phrase past the cap, once, and none at the cap', () => {
    const at = CAPS.phrasesPerVerb;
    expect(checked(`verb v { role r0  ${phrases(at)} }`)).toEqual([]);
    const said = checked(`verb v { role r0  ${phrases(at + 1)} }`);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(
      `\`v\` has ${at + 1} phrases, and ${at} is as many as a verb may have.`,
    );
  });

  it('counts a phrase’s characters as it means them, after escapes', () => {
    const at = CAPS.phraseCharacters;
    const fits = `"${'a'.repeat(at - '[r0]'.length - 3)}\\"\\" [r0]"`;
    expect(checked(`verb v { role r0  ${fits} }`)).toEqual([]);
    const over = `"${'a'.repeat(at - '[r0]'.length)} [r0]"`;
    expect(checked(`verb v { role r0  ${over} }`)).toEqual([
      `v.sprout:1:19 This phrase is ${at + 1} characters long, and ${at} is as long as a phrase may be.`,
    ]);
  });

  it('takes its figures from the host, never its own', () => {
    const caps = limitsFrom({
      caps: { rolesPerVerb: 2, phrasesPerVerb: 1, phraseCharacters: 5 },
    }).caps;
    expect(checked('verb v { role r0  role r1 }', caps)).toEqual([]);
    expect(checked('verb v { role r0  role r1  role r2 }', caps)).toEqual([
      'v.sprout:1:28 `v` has 3 roles, and 2 is as many as a verb may have.',
    ]);
    expect(checked('verb v { role r0  "[r0]"  "x [r0]" }', caps)).toEqual([
      'v.sprout:1:27 `v` has 2 phrases, and 1 is as many as a verb may have.',
      'v.sprout:1:27 This phrase is 6 characters long, and 5 is as long as a phrase may be.',
    ]);
  });
});

// --- the second tier ----------------------------------------------------------

/**
 * Every library's text, read into the tables a verb resolves against, in
 * the order the second tier builds them: enums, kinds, then verbs.
 */
function resolved(libraries: Record<string, string>, onUnknownKind?: OnUnknown) {
  const parsing = new Diagnostics();
  const byLibrary = Object.entries(libraries).map(
    ([library, text]) =>
      [library, parseDeclarations(new SourceFile(`${library}.sprout`, text), parsing)] as const,
  );
  expect(parsing.refusals, 'the fixture parses').toEqual([]);
  const diagnostics = new Diagnostics();
  const enums = new EnumTable();
  const kinds = new KindTable();
  for (const [library, declared] of byLibrary) {
    enums.add(
      library,
      declared.filter((d) => d.kind === 'enum'),
      diagnostics,
    );
    kinds.add(
      library,
      declared.filter((d) => d.kind === 'kind'),
      diagnostics,
    );
  }
  kinds.resolve(enums, diagnostics);
  const verbs = new VerbTable();
  for (const [library, declared] of byLibrary) {
    verbs.add(
      library,
      declared.filter((d) => d.kind === 'verb'),
      { kinds, enums, diagnostics, ...(onUnknownKind === undefined ? {} : { onUnknownKind }) },
    );
  }
  return {
    verbs,
    diagnostics,
    said: diagnostics.refusals.map((d) => `${locationOf(d.at)} ${d.message}`),
  };
}

/** One verb the world `shop` declares, resolved with nothing refused. */
function shopVerb(text: string, sprout = ''): ResolvedVerb {
  const { verbs, said } = resolved({ sprout, shop: text });
  expect(said, text).toEqual([]);
  return verbs.all().find((verb) => verb.library === 'shop')!;
}

/** A role by name. */
function role(verb: ResolvedVerb, name: string): ResolvedRole {
  return verb.roles.find((r) => r.name === name)!;
}

describe('the verb table holds every library’s verbs, each by its library and its name', () => {
  it('finds a verb qualified, and unqualified as the world’s own first, then the standard library’s', () => {
    const { verbs, said } = resolved({
      sprout:
        'verb take { role target  "take [target]" }\nverb drop { role target  "drop [target]" }',
      shop: 'verb take { role target  "take [target]"  "nab [target]" }',
      textiles: 'verb weave { role target  "weave [target]" }',
    });
    expect(said).toEqual([]);
    expect(verbs.all().map((v) => `${v.library}.${v.name}`)).toEqual([
      'sprout.take',
      'sprout.drop',
      'shop.take',
      'textiles.weave',
    ]);
    expect(verbs.unqualified('take', 'shop')!.library).toBe('shop');
    expect(verbs.unqualified('drop', 'shop')!.library).toBe('sprout');
    // The qualified name still reaches the library's.
    expect(verbs.qualified('sprout', 'take')!.phrases).toHaveLength(1);
    // Another library's verb is reachable only by its library, never bare.
    expect(verbs.unqualified('weave', 'shop')).toBeNull();
    expect(verbs.qualified('textiles', 'weave')).not.toBeNull();
    expect(verbs.qualified('shop', 'drop')).toBeNull();
  });

  it('resolves what fills each role, the first being the target', () => {
    const verb = shopVerb(
      'kind Key { }\nverb fiddle { role target: Lockable  role tool: Key  role pick: sprout.Key  role topic: symbol  role dial: integer  role other  "fiddle [target] with [tool] [pick] [topic] [dial] [other]" }',
      'kind Lockable { }\nkind Key { }',
    );
    const fills = verb.roles.map((r) => {
      const filler = r.filler!;
      return [r.name, filler.fills === 'kind' ? kindName(filler.kind) : filler.fills];
    });
    expect(fills).toEqual([
      // Bare, it is the world's own where it declares one, else the standard library's.
      ['target', 'sprout.Lockable'],
      ['tool', 'shop.Key'],
      ['pick', 'sprout.Key'],
      ['topic', 'symbol'],
      ['dial', 'integer'],
      ['other', 'open'],
    ]);
  });

  it('reads a role’s kind from the library that declared the verb', () => {
    const { verbs, said } = resolved({
      sprout:
        'kind Actor { }\nverb give { role item  role recipient: Actor  "give [item] to [recipient]" }',
      shop: 'kind Actor { }',
    });
    expect(said).toEqual([]);
    const recipient = role(verbs.qualified('sprout', 'give')!, 'recipient').filler!;
    expect(recipient.fills === 'kind' && kindName(recipient.kind)).toBe('sprout.Actor');
  });

  it('gives each phrase its words and its slots, a slot by the index of the role it fills', () => {
    const verb = shopVerb(
      'verb unlock { role target  role tool  "use [tool] on [target]"  "unlock [target]" }',
    );
    expect(verb.phrases.map((p) => [p.text, p.parts])).toEqual([
      [
        'use [tool] on [target]',
        [
          { part: 'words', text: 'use' },
          { part: 'slot', role: 1 },
          { part: 'words', text: 'on' },
          { part: 'slot', role: 0 },
        ],
      ],
      [
        'unlock [target]',
        [
          { part: 'words', text: 'unlock' },
          { part: 'slot', role: 0 },
        ],
      ],
    ]);
  });
});

describe('whether a role is optional is decided here, from the verb’s phrases', () => {
  /** Each role as `name` or `name?`, with the phrase that leaves out an optional one. */
  const optionality = (verb: ResolvedVerb): string[] =>
    verb.roles.map((r) =>
      r.optional
        ? `${r.name}? ${r.omittedBy === null ? '(every phrase fills it)' : `(left out by "${r.omittedBy.text}")`}`
        : r.name,
    );

  it('makes a thing some phrase leaves out optional, naming the first phrase that does', () => {
    const verb = shopVerb(
      'verb unlock { role target  role tool  role hand  "unlock [target] with [tool] by [hand]"  "unlock [target] by [hand]"  "open [target] by [hand]" }',
    );
    expect(optionality(verb)).toEqual([
      'target',
      'tool? (left out by "unlock [target] by [hand]")',
      // Every phrase fills it, so it needs nothing.
      'hand',
    ]);
    // The same phrase object, so a refusal can point at where it was written.
    expect(role(verb, 'tool').omittedBy).toBe(verb.phrases[1]);
  });

  it('never makes a set role optional, since the empty set is already an answer', () => {
    const verb = shopVerb(
      'verb work { role target  role tools many  "work [target]"  "work [target] with [tools]" }',
    );
    expect(optionality(verb)).toEqual(['target', 'tools']);
    expect(role(verb, 'tools')).toMatchObject({ many: true, optional: false, omittedBy: null });
  });

  it('makes every value role optional, whatever the phrases say', () => {
    const verb = shopVerb(
      'verb ask { role target  role topic: symbol  role n: integer  "ask [target] about [topic] [n]"  "ask [target] [n]" }',
    );
    expect(optionality(verb)).toEqual([
      'target',
      'topic? (left out by "ask [target] [n]")',
      'n? (every phrase fills it)',
    ]);
  });

  it('makes a value role optional in the target’s place too', () => {
    const verb = shopVerb('verb ask { role target: symbol  "ask about [target]" }');
    expect(optionality(verb)).toEqual(['target? (every phrase fills it)']);
  });

  it('takes `optional` as written on a verb with no phrases, which has nothing to infer from', () => {
    const verb = shopVerb(
      'verb nudge { role target  role tool optional  role gift  role topic: symbol }',
    );
    expect(optionality(verb)).toEqual([
      'target',
      'tool? (every phrase fills it)',
      'gift',
      'topic? (every phrase fills it)',
    ]);
  });

  it('does not make the engine’s `go` way optional, since every phrase fills it', () => {
    const { verbs } = resolved({ sprout: 'verb go { role way: exit  "go [way]"  "[way]" }' });
    expect(verbs.qualified('sprout', 'go')!.roles[0]).toMatchObject({
      filler: { fills: 'exit' },
      optional: false,
      omittedBy: null,
    });
  });
});

describe('what the table refuses, at the thing', () => {
  it('two verbs of one name in one library, at the second, keeping the first', () => {
    const { verbs, said, diagnostics } = resolved({
      shop: 'verb take { role target  "take [target]" }\nverb take { role item  "nab [item]" }',
    });
    expect(said).toEqual(['shop.sprout:2:6 shop declares two verbs called `take`.']);
    expect(diagnostics.refusals[0]!.remedy).toBe('Give one of them another name, or remove it.');
    expect(verbs.qualified('shop', 'take')!.roles[0]!.name).toBe('target');
  });

  it('an engine verb’s name in any library but the standard one', () => {
    for (const name of ENGINE_VERBS) {
      const { verbs, said } = resolved({
        sprout: `verb ${name} { }`,
        shop: `verb ${name} { }`,
        textiles: `verb ${name} { }`,
      });
      expect(said, name).toEqual([
        `shop.sprout:1:6 \`${name}\` is one of the engine's verbs, and only the standard library declares those.`,
        `textiles.sprout:1:6 \`${name}\` is one of the engine's verbs, and only the standard library declares those.`,
      ]);
      // The standard library's stands, and a bare name reaches it.
      expect(verbs.unqualified(name, 'shop')!.library).toBe('sprout');
    }
    const { diagnostics } = resolved({ shop: 'verb look { "peer" }' });
    expect(diagnostics.refusals[0]!.remedy).toBe(
      'The engine answers `go`, `look`, `examine`, `inventory`, `wait` and `help` itself. Give yours another name.',
    );
  });

  it('`exit` on any role but the standard library’s `go`’s, at `exit`', () => {
    const { said, diagnostics } = resolved({
      sprout:
        'verb go { role way: exit  "go [way]" }\nverb climb { role way: exit  "climb [way]" }',
      shop: 'verb leave { role target  role way: exit  "leave [target] by [way]" }',
    });
    expect(said).toEqual([
      "sprout.sprout:2:24 `exit` fills a role only on the engine's `go`.",
      "shop.sprout:1:37 `exit` fills a role only on the engine's `go`.",
    ]);
    expect(diagnostics.refusals[0]!.remedy).toBe(
      'A role is filled by a kind (`role target: Container`), by `symbol` or `integer` for a value the visitor names, or by nothing.',
    );
  });

  it('a role naming an enum, the world’s, the standard library’s or one qualified', () => {
    const { verbs, said, diagnostics } = resolved({
      sprout: 'enum Mood { calm, cross }',
      shop: 'enum Topic { bridge, toll }\nverb ask { role target  role topic: Topic  role mood: Mood  role also: sprout.Mood }',
    });
    expect(said).toEqual([
      'shop.sprout:2:37 `Topic` is an enum, and a role is not filled by one.',
      'shop.sprout:2:55 `Mood` is an enum, and a role is not filled by one.',
      'shop.sprout:2:72 `sprout.Mood` is an enum, and a role is not filled by one.',
    ]);
    expect(diagnostics.refusals[0]!.remedy).toBe(
      'Write `role topic: symbol`. The object that plays the role says which options it hears with `topic from :<property>`, a property holding a list of `Topic`.',
    );
    // Nothing fills the role, and the verb is still there.
    expect(role(verbs.qualified('shop', 'ask')!, 'topic').filler).toBeNull();
  });

  it('a kind nothing declares, with the kind it most likely meant, refused where nothing is told', () => {
    const { verbs, said, diagnostics } = resolved({
      sprout: 'kind Lockable { }',
      shop: 'verb unlock { role target: Lockabel  role tool: victorian.Key  "unlock [target] with [tool]" }',
    });
    expect(said).toEqual([
      'shop.sprout:1:28 Nothing here is a `Lockabel`. Did you mean `Lockable`?',
      'shop.sprout:1:49 Nothing here is a `victorian.Key`.',
    ]);
    expect(diagnostics.refusals[0]!.remedy).toBe(
      'Write `Lockable`, or declare `Lockabel` with `kind Lockabel { … }`.',
    );
    expect(verbs.qualified('shop', 'unlock')!.roles.map((r) => r.filler)).toEqual([null, null]);
  });

  it('a kind nothing declares is told to `onUnknownKind` instead, and the role fills nothing', () => {
    const told: string[] = [];
    const { verbs, diagnostics } = resolved(
      { shop: 'verb unlock { role target: Lockabel  "unlock [target]" }' },
      (written, message) => told.push(`${locationOf(written.at)} ${message}`),
    );
    expect(diagnostics.all).toEqual([]);
    expect(told).toEqual(['shop.sprout:1:28 Nothing here is a `Lockabel`.']);
    expect(verbs.qualified('shop', 'unlock')!.roles[0]!.filler).toBeNull();
  });

  it('says nothing more of a kind that was declared and could not be composed', () => {
    const { verbs, diagnostics } = resolved({
      shop: 'kind Crate: victorian.Box { }\nverb pack { role target: Crate  "pack [target]" }',
    });
    // Only the composition's own refusal, where the kind was declared.
    expect(diagnostics.refusals.map((d) => locationOf(d.at))).toEqual(['shop.sprout:1:13']);
    expect(verbs.qualified('shop', 'pack')!.roles[0]!.filler).toBeNull();
  });
});
