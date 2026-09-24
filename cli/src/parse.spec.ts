import { describe, expect, it } from 'vitest';

import { checkWorld } from './check.js';
import { formatGrammar, parseLine } from './parse.js';
import { catalogueFor, standIn, type Standing } from './stand.js';
import { LANE, worldFolder } from './testing.js';

const lane = () => checkWorld(worldFolder('lane', LANE)).bundle!;
const at = (place?: string): Standing => standIn(lane(), place === undefined ? {} : { at: place });
const read = (line: string, standing = at()) => parseLine(line, standing);

describe('formatGrammar', () => {
  it('lists every phrase under its verb and roles, the world’s verbs first, in the order they are tried', () => {
    expect(formatGrammar(catalogueFor(lane()))).toBe(
      `lane accepts these phrases, in the order they are tried; the first that reads wins.

lane.pry (target)
  pry [target]
  pry open [target]

lane.turn (target, notch: integer optional)
  turn [target] to [notch]

sprout.go (way: exit)
  go [way]
  [way]
  walk [way]

sprout.look
  look
  l
  look around

sprout.examine (target)
  examine [target]
  x [target]
  look at [target]
  inspect [target]

sprout.inventory
  inventory
  i
  inv

sprout.wait
  wait
  z

sprout.help
  help
  ?

sprout.take (target)
  take [target]
  get [target]
  pick up [target]
  grab [target]

sprout.drop (target)
  drop [target]
  put down [target]

sprout.give (item, recipient: sprout.Actor)
  give [item] to [recipient]
  hand [item] to [recipient]

sprout.ask (target, topic: symbol optional)
  ask [target] about [topic]
  ask [target] [topic]
`,
    );
  });

  it('leaves out a library verb the world’s own of that name shadows', () => {
    const shadowed = worldFolder('lane', {
      ...LANE,
      'lane.sprout': LANE['lane.sprout']! + 'verb take { role target  "take [target]" }\n',
    });
    const page = formatGrammar(catalogueFor(checkWorld(shadowed).bundle!));
    expect(page).toContain('lane.take (target)\n  take [target]\n');
    expect(page).not.toContain('sprout.take');
  });
});

describe('parseLine', () => {
  it('names the reading, what fills each role, and that everyone consents', () => {
    expect(read('ask warden about old road')).toEqual({
      ok: true,
      page: `in yard, "ask warden about old road" reads as sprout.ask
  target: a warden (yard.warden)
  topic: :old_road
every participant consents
`,
    });
  });

  it('says a value role a participant does not hear is unbound', () => {
    expect(read('ask warden about weather').page).toContain('  topic: unbound\n');
    expect(read('turn dial to 7').page).toContain('  notch: 7\n');
  });

  it('names an exit by its direction, label and where it leads', () => {
    expect(read('in').page).toBe(`in yard, "in" reads as sprout.go
  way: exit in "into the shed" -> shed
every participant consents
`);
  });

  it('gives the consent pass’s refusal, who refused, in which role and kind, in their words', () => {
    expect(read('pry open crate').page).toBe(`in yard, "pry open crate" reads as lane.pry
  target: a crate (yard.crate)
refused by a crate (yard.crate) as target, in lane.Crate's permit:
  The lid is nailed down.
`);
  });

  it('gives a `which` with the line that means each candidate', () => {
    expect(read('take key').page)
      .toBe(`in yard, "take key" not understood; the world answers with \`which\`:
  Which do you mean: a brass key, an iron key?
  "take brass key" means a brass key (yard.brass_key)
  "take iron key" means an iron key (yard.iron_key)
`);
  });

  it('answers a word nobody reads with `unknown`, and a thing out of range with `not_here`', () => {
    expect(read('frobnicate').page).toBe(
      `in yard, "frobnicate" not understood; the world answers with \`unknown\`:
  That is not something you can do here.
`,
    );
    expect(read('take crate', at('shed')).page).toBe(
      `in shed, "take crate" not understood; the world answers with \`not_here\`:
  You see nothing like that here.
`,
    );
  });

  it('writes nothing: the reading is never run', () => {
    const standing = at();
    read('pry crate', standing);
    read('go in', standing);
    expect(read('pry crate', standing).page).toContain('refused by a crate');
    expect(standing.state.instances.get(standing.actor)!.container).toBe(standing.place);
  });

  it('says a line that costs more than a command turn’s steps faults, as its turn would', () => {
    const standing = at();
    const { budgets } = standing.host;
    const starved = { ...standing, host: { ...standing.host, budgets: { ...budgets, steps: 3 } } };
    const parsed = read('take key', starved);
    expect(parsed.ok).toBe(false);
    expect(parsed.page).toMatch(/^in yard, "take key" faults as its turn would, BudgetExhausted: /);
  });
});
