import { describe, expect, it } from 'vitest';

import { readFile } from '../bundle/compile/reading.js';
import { limitsFrom } from '../bundle/limits.js';
import { compiledWorld, compileWorld } from '../fixtures/bundle.js';
import { locationOf, SourceFile } from '../source/source.js';

/** What reading `text` as its own file said, as `line:col message`. */
const said = (text: string, caps = limitsFrom({}).caps) =>
  readFile(new SourceFile('i.sprout', text), caps).diagnostics.map(
    (d) => `${locationOf(d.at).slice('i.sprout:'.length)} ${d.message}`,
  );

/** A world whose own verbs and intents are `verbs`, a lockable chest in its hall. */
const shop = (verbs: string) => ({
  'shop.sprout': `world shop is sprout.World {
  visitors are Person
  visitors arrive at hall
  object hall is sprout.Place {
    object chest is Chest
    object key is sprout.Fixture
  }
}
kind Chest is sprout.Container, sprout.Lockable { }
${verbs}`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});

/** What compiling `files` refused, as `line:col message`. */
const refusedIn = (files: Record<string, string>) =>
  compileWorld('shop', files).diagnostics.flatMap((d) =>
    d.severity === 'refusal' ? [`${locationOf(d.at)} ${d.message}`] : [],
  );

describe('an intent, as its file is read', () => {
  it('says nothing of one written well', () => {
    expect(
      said(
        'intent pry_open { "pry [y] open with [x]"  do unlock (target: y, tool: x) then open (target: y) }\n',
      ),
    ).toEqual([]);
  });

  it('refuses one with no steps, and one with no phrase', () => {
    expect(said('intent a { "a" }\nintent b { do look }\n')).toEqual([
      '1:8 `a` has no steps.',
      '2:8 `b` has no phrase a visitor could type.',
    ]);
  });

  it('holds its steps and phrases to the host’s caps, its phrases counted as a verb’s', () => {
    const caps = limitsFrom({ caps: { stepsPerIntent: 2, phrasesPerVerb: 1 } }).caps;
    expect(said('intent a { "a"  "b"  do look then wait then look }\n', caps)).toEqual([
      '1:45 `a` has 3 steps, and 2 is as many as an intent may have.',
      '1:17 `a` has 2 phrases, and 1 is as many as an intent may have.',
    ]);
  });

  it('refuses a slot no step gives a role, and a slot no phrase names', () => {
    expect(
      said('intent a { "a [y] [z]"  do open (target: y) then unlock (target: y, tool: x) }\n'),
    ).toEqual([
      '1:19 `"a [y] [z]"` names `z`, and no step of `a` gives it a role.',
      '1:75 `x` fills a role, and no phrase of `a` names it, so nothing could fill it.',
    ]);
  });

  it('refuses a phrase written twice, a slot named twice in a phrase, and a role given twice', () => {
    expect(
      said('intent a { "a [y]"  "a [y]"  "b [y] [y]"  do open (target: y, target: y) }\n'),
    ).toEqual([
      '1:21 `a` has the phrase `"a [y]"` twice.',
      '1:37 `"b [y] [y]"` names `y` twice.',
      '1:63 This step gives `target` twice.',
    ]);
  });
});

describe('an intent, across the bundle', () => {
  it('resolves each step’s verb and the slot filling each role, and what may fill each slot', () => {
    const bundle = compiledWorld(
      'shop',
      shop(
        'intent pry { "pry [y] with [x]"  do unlock (target: y, tool: x) then open (target: y) }\n',
      ),
    );
    const pry = bundle.intents.find((one) => one.name === 'pry')!;
    expect(pry.slots).toEqual(['y', 'x']);
    expect(pry.steps.map((step) => [step.verb.name, [...step.fillers]])).toEqual([
      [
        'unlock',
        [
          ['target', 0],
          ['tool', 1],
        ],
      ],
      ['open', [['target', 0]]],
    ]);
    expect(pry.slotRoles.map((roles) => roles.map((role) => role.name))).toEqual([
      ['target', 'target'],
      ['tool'],
    ]);
  });

  it('replaces a library’s intent with the world’s of its name', () => {
    const bundle = compiledWorld(
      'shop',
      shop('intent open_with { "force [y]"  do open (target: y) }\n'),
    );
    const named = bundle.intents.filter((one) => one.name === 'open_with');
    expect(named.map((one) => one.library)).toEqual(['shop']);
    expect(named[0]!.phrases.map((one) => one.text)).toEqual(['force [y]']);
  });

  it('refuses a verb nothing declares, a role the verb lacks and nothing more of its step, a value role, and a role the verb needs and is not given', () => {
    expect(
      refusedIn(
        shop(
          [
            'verb ask_about { role target  role topic: symbol  "ask [target] about [topic]" }',
            'intent a { "a [y] [x]"  do unlok (target: y) then open (lid: y) then ask_about (target: y, topic: x) then unlock (target: y) }',
            '',
          ].join('\n'),
        ),
      ),
    ).toEqual([
      'shop.sprout:11:28 This step performs `unlok`, and nothing declares that verb. Did you mean `unlock`?',
      'shop.sprout:11:57 `open` has no role `lid`.',
      'shop.sprout:11:92 `topic` of `ask_about` takes a value, and a slot of an intent holds a thing.',
      'shop.sprout:11:107 This step performs `unlock` and gives no slot to `tool`, which it needs.',
    ]);
  });

  it('refuses a verb whose needed role a value or a way out fills, which no slot can', () => {
    expect(refusedIn(shop('intent a { "a"  do go }\n'))).toEqual([
      'shop.sprout:10:20 This step performs `go`, which needs `way`, a way out, and a slot of an intent holds a thing.',
    ]);
  });

  it('asks nothing of how the phrases and steps agree where one of them was not read', () => {
    expect(
      said(
        'intent a { "a [y]"  do (target: y) }\nintent b { "b [y]" "c [" do open (target: y, tool: x) }\n',
      ),
    ).toEqual(['1:24 A step names the verb it performs.', '2:23 This slot is never closed.']);
  });
});
