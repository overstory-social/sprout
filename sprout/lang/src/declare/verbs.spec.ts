import { describe, expect, it } from 'vitest';

import type { VerbDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';
import { checkVerbDeclaration, type VerbCaps } from './verbs.js';

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
