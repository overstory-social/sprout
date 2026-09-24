import { describe, expect, it } from 'vitest';

import type { ActStatement } from '../ast.js';
import { writtenPath } from '../ast.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { chooser } from '../../fixtures/parse.js';
import { inKindBody, readWith, rest } from '../../fixtures/readers.js';
import { actStatement } from './act.js';
import { play } from './roles.js';
import { block, onItsOwn } from './statements.js';

/** An `act` as the parser holds it, written back: `act nuzzle (target: p)`. */
function actShape(act: ActStatement): string {
  const roles = act.roles.map((role) => `${role.role.text}: ${writtenPath(role.filler)}`);
  return `act ${act.verb.text} (${roles.join(', ')})`;
}

/** One `act`, read by `actStatement` from the start of `text`. */
const readAct = (text: string) => readWith(actStatement, text, { name: 'body.sprout' });

/** What was said reading `text` as one `act`: location, message and remedy. */
const said = (text: string) =>
  readAct(text).refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);

/** A block read on its own: the kinds of statement it kept, and how many refusals. */
function blockOf(text: string) {
  const { read, refusals } = readWith((p) => block(p, onItsOwn()), text, { name: 'body.sprout' });
  return { kinds: read?.statements.map((one) => one.kind) ?? null, refusals };
}

describe('`act` performs a verb with `self` as the actor', () => {
  it('reads the spec’s own, and a verb with several roles, none, or a dotted filler', () => {
    for (const text of [
      'act nuzzle (target: p)',
      'act unlock (target: door, tool: key)',
      'act look ()',
      'act take (target: kiln.cup)',
    ]) {
      const { read, refusals, p } = readAct(text);
      expect(refusals, text).toEqual([]);
      expect(unspanned(read), text).toEqual([]);
      expect(read!.kind, text).toBe('act');
      expect(actShape(read!), text).toBe(text);
      expect(p.done, text).toBe(true);
    }
  });

  it('is read by its own reader, spanning from the word to the closing bracket', () => {
    const text = 'act unlock (target: door,  tool: key) after';
    const { read, refusals, p } = readAct(text);
    expect(refusals).toEqual([]);
    expect(rest(p)).toBe('after');
    expect(textOf(read!.at)).toBe('act unlock (target: door,  tool: key)');
    expect(read!.roles.map((role) => textOf(role.at))).toEqual(['target: door', 'tool: key']);
    expect(locationOf(read!.roles[1]!.filler.at)).toBe('body.sprout:1:34');
  });

  it('takes a comma after the last role, and a role written against its colon', () => {
    expect(actShape(readAct('act nuzzle (target: p,)').read!)).toBe('act nuzzle (target: p)');
    const joined = readAct('act nuzzle (target:p)');
    expect(joined.refusals).toEqual([]);
    const filler = joined.read!.roles[0]!.filler;
    expect(writtenPath(filler)).toBe('p');
    expect(locationOf(filler.at)).toBe('body.sprout:1:20');
  });

  it('refuses each part missing or written wrong, once, where it is', () => {
    const table: [string, string, string, string][] = [
      [
        'act',
        'body.sprout:1:4',
        '`act` does not say which verb to perform.',
        'Write the verb and its roles, as in `act nuzzle (target: p)`.',
      ],
      [
        'act (target: p)',
        'body.sprout:1:4',
        '`act` does not say which verb to perform.',
        'Write the verb and its roles, as in `act nuzzle (target: p)`.',
      ],
      [
        'act 7 (target: p)',
        'body.sprout:1:5',
        '`act` does not say which verb to perform.',
        'Write the verb and its roles, as in `act nuzzle (target: p)`.',
      ],
      [
        'act Nuzzle (target: p)',
        'body.sprout:1:5',
        "`Nuzzle` starts with a capital, and a verb's name does not.",
        "Write the verb's name in lower case, as in `act nuzzle (target: p)`.",
      ],
      [
        'act sprout.take (target: p)',
        'body.sprout:1:5',
        '`act` names a verb by its name alone.',
        "Write `act take (…)`: a verb's name reaches this world's own verb first, then the standard library's.",
      ],
      [
        'act nuzzle',
        'body.sprout:1:11',
        '`act nuzzle` names its roles in brackets.',
        'Write `act nuzzle (target: p)`, or `act nuzzle ()` where it has no roles to fill.',
      ],
      [
        'act nuzzle target: p',
        'body.sprout:1:11',
        '`act nuzzle` names its roles in brackets.',
        'Write `act nuzzle (target: p)`, or `act nuzzle ()` where it has no roles to fill.',
      ],
      [
        'act nuzzle (7: p)',
        'body.sprout:1:13',
        "Inside `act nuzzle (…)` each role is named before what fills it, and the number 7 is not a role's name.",
        'Write `<role>: <what fills it>`, as in `act nuzzle (target: p)`.',
      ],
      [
        'act nuzzle (target)',
        'body.sprout:1:19',
        '`target` is not given anything to fill it.',
        'Write `target: <what fills it>`, as in `act nuzzle (target: p)`.',
      ],
      [
        'act nuzzle (target: )',
        'body.sprout:1:20',
        '`target` is not given anything to fill it.',
        'Write `target: <what fills it>`, as in `act nuzzle (target: p)`.',
      ],
      [
        'act ask (target: guard, topic: :toll)',
        'body.sprout:1:32',
        '`topic` is filled by the name of something in reach, and `:toll` is not one.',
        'Name something in reach in lower case, as in `topic: p`, where `p` is a binding or a role.',
      ],
      [
        'act nuzzle (target: Cat)',
        'body.sprout:1:21',
        '`target` is filled by the name of something in reach, and `Cat` is not one.',
        'Name something in reach in lower case, as in `target: p`, where `p` is a binding or a role.',
      ],
      [
        'act unlock (target: door tool: key)',
        'body.sprout:1:26',
        'The roles inside `act unlock (…)` are separated by commas.',
        'Write a comma between each two, as in `act unlock (target: p, tool: q)`.',
      ],
      [
        'act nuzzle (target: p',
        'body.sprout:1:22',
        'The bracket after `act nuzzle` is never closed.',
        'Add a ) after its last role.',
      ],
    ];
    for (const [text, where, message, remedy] of table) {
      expect(readAct(text).read, text).toBeNull();
      expect(said(text), text).toEqual([[where, message, remedy]]);
    }
  });
});

/** Refused `act`s, each costing only itself, with the words that follow them. */
const DEFECTIVE = [
  'act',
  'act Nuzzle (target: p)',
  'act nuzzle',
  'act nuzzle (',
  'act nuzzle (target',
  'act nuzzle (target:',
  'act nuzzle (target: p',
  'act nuzzle (target: p tool: q)',
  'act nuzzle (target: :toll)',
  'act nuzzle (7)',
  'act sprout.take (target: p)',
];

/** Statements well formed on their own, one of which follows each defect. */
const FOLLOWING = [
  ['say "after"', 'say'],
  ['move target to self', 'move'],
  ['act purr ()', 'act'],
  ['if (a) { allow }', 'if'],
  ['let n = 1', 'let'],
  ['self.set(:open, true)', 'expression-statement'],
] as const;

describe('a refused `act` never takes what follows it', () => {
  it('keeps the statement on the next line, whatever the defect, and says one thing', () => {
    const c = chooser(26);
    for (let run = 0; run < 200; run++) {
      const defect = c.one(DEFECTIVE);
      const [before, beforeKind] = c.one(FOLLOWING);
      const [after, afterKind] = c.one(FOLLOWING);
      const text = `{ ${before}\n  ${defect}\n  ${after} }`;
      const { kinds, refusals } = blockOf(text);
      expect(refusals, text).toHaveLength(1);
      expect(kinds, text).toEqual([beforeKind, afterKind]);
    }
  });

  it('keeps the member after a play whose `do` holds one, and the play itself', () => {
    for (const defect of DEFECTIVE) {
      const members = `as actor for purr { do { ${defect}\n  say "after" } }\n  :fed false`;
      const { p, diagnostics, startsMember } = inKindBody(members, 'Cat');
      const read = play(p, 'Cat', startsMember);
      expect(diagnostics.refusals, members).toHaveLength(1);
      expect(rest(p), members).toBe(':fed false\n}\n');
      expect(
        read!.do!.statements.map((one) => one.kind),
        members,
      ).toEqual(['say']);
    }
  });
});
