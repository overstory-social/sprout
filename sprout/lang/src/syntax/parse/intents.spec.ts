import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../../source/diagnostics.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import type { IntentDeclaration } from '../ast-verbs.js';
import { chooser } from '../../fixtures/parse.js';
import { parseDeclarations } from '../parse.js';

/** What `text` declares, and what reading it said, as `line:col message`. */
function read(text: string) {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('i.sprout', text), diagnostics);
  const said = diagnostics.refusals.map(
    (d) => `${locationOf(d.at).slice('i.sprout:'.length)} ${d.message}`,
  );
  return { declared, said };
}

describe('an intent', () => {
  it('reads its phrases, then its steps joined by `then`, each with its fillers and a `when`', () => {
    const { declared, said } = read(
      'intent open_with {\n  "open [y] with [x]"\n  "use [x] to open [y]"\n  do unlock (target: y, tool: x) when (y.get(:locked)) then open (target: y)\n}\n',
    );
    expect(said).toEqual([]);
    const intent = declared[0] as IntentDeclaration;
    expect(intent.name.text).toBe('open_with');
    expect(intent.phrases.map((one) => one.text)).toEqual([
      'open [y] with [x]',
      'use [x] to open [y]',
    ]);
    expect(
      intent.steps.map((step) => [
        step.verb.text,
        step.fillers.map((one) => `${one.role.text}:${one.slot.text}`),
        step.when === null ? null : textOf(step.when.at),
      ]),
    ).toEqual([
      ['unlock', ['target:y', 'tool:x'], 'y.get(:locked)'],
      ['open', ['target:y'], null],
    ]);
  });

  it('reads a step of a verb with no roles without brackets', () => {
    const { declared, said } = read('intent glance { "glance"  do look then wait }\n');
    expect(said).toEqual([]);
    expect((declared[0] as IntentDeclaration).steps.map((one) => one.verb.text)).toEqual([
      'look',
      'wait',
    ]);
  });

  it('refuses a filler that is not a role, a colon and a slot, a `when` with no condition, and a second `do`', () => {
    const { said } = read(
      'intent a { "a [y]"  do take (y) }\nintent b { "b"  do look when }\nintent c { "c"  do look  do wait }\n',
    );
    expect(said).toEqual([
      "1:30 A step's role is its name, a colon, and the slot that fills it.",
      "2:29 A step's `when` is followed by its condition in brackets.",
      '3:26 `c` writes its steps twice.',
    ]);
  });

  it('refuses what an intent is not made of once, up to its next phrase or step, and one never closed', () => {
    const { declared, said } = read('intent a { role target  "a"  do look }\n');
    expect(said).toEqual(['1:12 An intent is not made of `role`.']);
    expect((declared[0] as IntentDeclaration).phrases.map((one) => one.text)).toEqual(['a']);
    expect(read('intent a { "a"  do look\n').said).toEqual(['2:1 `a` is never closed.']);
  });

  it('keeps the steps around one it cannot read, and says the intent was not read whole', () => {
    const { declared, said } = read(
      'intent a { "a [y]"  do look then (y) when (true) then wait }\n',
    );
    expect(said).toEqual(['1:34 A step names the verb it performs.']);
    const intent = declared[0] as IntentDeclaration;
    expect(intent.steps.map((one) => one.verb.text)).toEqual(['look', 'wait']);
    expect(intent.whole).toBe(false);
    expect((read('intent a { "a"  do look }\n').declared[0] as IntentDeclaration).whole).toBe(true);
  });

  it('refuses a name that starts with a capital, a word of the language, and none', () => {
    expect(read('intent Stash { "stash"  do look }\n').said).toEqual([
      "1:8 An intent's name is a lower-case word, and `Stash` starts with a capital.",
    ]);
    expect(read('intent do { "a"  do look }\n').said).toEqual([
      '1:8 `do` is a word of the language, so it cannot name an intent.',
    ]);
    expect(read('intent { "a"  do look }\n').said).toEqual(['1:8 `intent` needs a name.']);
  });
});

// --- the recovery invariant ------------------------------------------------

const WELL_FORMED_STEPS = [
  { verb: 'look', text: 'look' },
  { verb: 'unlock', text: 'unlock (target: y, tool: x)' },
  { verb: 'open', text: 'open (target: y) when (y.get(:locked))' },
  { verb: 'take', text: 'take (target: x)' },
] as const;

/** A step with one defect in it, each costing that step at most. */
const STEP_DEFECTS: readonly string[] = [
  '(target: y)',
  'take (y)',
  'take (target y)',
  'take (target: y tool: x)',
  'take (: y)',
  'take (target: )',
  'take when',
  'take when true',
  'take when (',
  'take when (y.get(:locked)',
  'take when (y.get(:locked) +)',
  '4',
  'Take',
  ':lit',
];

describe('a defect in one step never loses a well-formed neighbour in silence (generated)', () => {
  it('keeps every step written well, around one written badly, and the declarations after it', () => {
    const c = chooser(357);
    for (let run = 0; run < 300; run++) {
      const good = c.shuffled(WELL_FORMED_STEPS).slice(0, 1 + c.below(3));
      const at = c.below(good.length + 1);
      const steps: string[] = good.map((step) => step.text);
      steps.splice(at, 0, c.one(STEP_DEFECTS));
      const between = c.below(2) === 0 ? ' ' : '\n    ';
      const text = `intent a {\n  "a [y] [x]"\n  do ${steps.join(`${between}then `)}\n}\nenum After { one }\n`;
      const { declared, said } = read(text);
      expect(said.length, text).toBeGreaterThan(0);
      const intent = declared.find((one): one is IntentDeclaration => one.kind === 'intent');
      const kept = intent?.steps.map((step) => step.verb.text) ?? [];
      expect(kept, text).toEqual(good.map((step) => step.verb));
      expect(intent?.whole, text).toBe(false);
      expect(
        declared.some((one) => one.kind === 'enum'),
        text,
      ).toBe(true);
    }
  });
});
