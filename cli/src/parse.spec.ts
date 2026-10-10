import { describe, expect, it } from 'vitest';

import { checkWorld } from './check.js';
import { formatGrammar, parseLine } from './parse.js';
import { catalogueFor, standIn, type Standing } from '@overstory/sprout-player';
import { LANE, worldFolder } from '@overstory/sprout-player/fixtures';

const lane = () => checkWorld(worldFolder('lane', LANE)).bundle!;
const at = (place?: string): Standing => standIn(lane(), place === undefined ? {} : { at: place });
const read = (line: string, standing = at()) => parseLine(line, standing);

describe('formatGrammar', () => {
  it('lists every phrase under its verb and roles, the world’s verbs first', () => {
    expect(formatGrammar(catalogueFor(lane()))).toBe(
      `lane accepts these phrases. Every way a line reads is ranked whole, and the best is understood.

lane.pry (target)
  pry [target]
  pry open [target]

lane.turn (target, notch: integer optional)
  turn [target] to [notch]

sprout.go (way: exit)
  go [way]
  [way]
  walk [way]
  go through [way]
  enter [way]

sprout.look
  look
  l
  look around

sprout.examine (target)
  examine [target]
  x [target]
  look at [target]
  inspect [target]
  describe [target]
  check [target]

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

sprout.take (target, source: sprout.Container optional)
  take [target]
  get [target]
  pick up [target]
  pick [target] up
  grab [target]
  take [target] from [source]
  take [target] out of [source]

sprout.drop (target)
  drop [target]
  put down [target]
  put [target] down
  drop [target] here
  put down [target] here
  put [target] down here

sprout.put (item, container: sprout.Container)
  put [item] in [container]
  put [item] into [container]
  place [item] in [container]
  insert [item] into [container]

sprout.give (item, recipient: sprout.Actor)
  give [item] to [recipient]
  hand [item] to [recipient]
  offer [item] to [recipient]

sprout.open (target: sprout.Container)
  open [target]

sprout.close (target: sprout.Container)
  close [target]
  shut [target]

sprout.look_in (target: sprout.Container)
  look in [target]
  look inside [target]
  look into [target]
  search [target]
  what is in [target]

sprout.unlock (target: sprout.Lockable, tool)
  unlock [target] with [tool]
  unlock [target] using [tool]
  use [tool] on [target]
  use [tool] to unlock [target]

sprout.ask (target, topic: symbol optional)
  ask [target] about [topic]
  ask [target] [topic]
  talk to [target] about [topic]

intent sprout.open_with, which does sprout.unlock, then sprout.open
  open [y] with [x]
  use [x] to open [y]
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

  it('lists the phrases synonyms give after the verb’s own, an object’s marked as its alone', () => {
    const withSynonyms = worldFolder('lane', {
      ...LANE,
      'lane.sprout': LANE['lane.sprout']!.replace(
        'object crate is Crate',
        'object crate is Crate { synonyms take: "heft" }',
      ).replace(
        'object yard is sprout.Place {',
        'synonyms take: "nab"\n  object yard is sprout.Place {',
      ),
    });
    const page = formatGrammar(catalogueFor(checkWorld(withSynonyms).bundle!));
    expect(page).toContain('  take [target] out of [source]\n  nab [target]\n');
    expect(page).toContain('  heft [target]   (only with yard.crate)\n');
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

  it('says a reading was drawn from several that tied, and what the visitor is told it meant', () => {
    expect(read('take key').page).toBe(`in yard, "take key" reads as sprout.take
  target: a brass key (yard.brass_key)
  source: unbound
drawn from 2 readings that tied, as a turn seeded 0 draws it; the visitor is told first:
  (a brass key)
every participant consents
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
    expect(parsed.page).toBe(
      'in yard, "take key" faults as its turn would, BudgetExhausted: steps: a command turn may take 3 steps.\n',
    );
  });
});

describe('parseLine, for an intent', () => {
  const vault = () =>
    checkWorld(
      worldFolder('lane', {
        ...LANE,
        'lane.sprout': LANE['lane.sprout']!.replace(
          'object crate is Crate',
          'object crate is Crate\n    object chest is Chest { :open false }\n    object gate is sprout.Lockable { :locked false }',
        ),
        'chest.sprout': 'kind Chest is sprout.Container, sprout.Lockable { }\n',
        // `unlock`'s tool is carried, so every walker carries a key of their own.
        'walker.sprout':
          'kind Walker is sprout.Visitor {\n  object ring_key is Key { grammar { name "ring key" } }\n}\n',
      }),
    ).bundle!;

  it('names the intent, what fills each slot, and the steps it plans now, each as a reading', () => {
    expect(parseLine('open chest with ring key', standIn(vault(), {})).page).toBe(
      `in yard, "open chest with ring key" reads as the intent sprout.open_with
  y: a chest (yard.chest)
  x: a ring key (lane#2)
it runs 2 steps, each a turn of its own:
  reads as sprout.unlock
    target: a chest (yard.chest)
    tool: a ring key (lane#2)
  reads as sprout.open
    target: a chest (yard.chest)
`,
    );
  });

  it('says a key lying in the yard is not carried, since `unlock`’s tool is', () => {
    expect(parseLine('open chest with brass key', standIn(vault(), {})).page).toBe(
      `in yard, "open chest with brass key" not understood; the world answers with \`not_carrying\`:
  You aren't carrying a brass key.
`,
    );
  });
  it('says where it plans no step, and that the line is answered with `nothing_happens`', () => {
    // The gate is unlocked, so no unlocking, and is no container, so no opening.
    const page = parseLine('open gate with ring key', standIn(vault(), {})).page;
    expect(page).toContain(
      'it plans no step that can run, and is answered with `nothing_happens`\n',
    );
  });
});

describe('parseLine, for a line of several commands', () => {
  it('reads each in turn against the world as it stands, since nothing runs', () => {
    const { ok, page } = read('ask warden about toll then pry crate');
    expect(ok).toBe(true);
    expect(page.split('\n')[0]).toBe(
      '"ask warden about toll then pry crate" holds 2 commands, each its own turn; each is read here against the world as it stands now, since nothing runs:',
    );
    expect(page).toContain('in yard, "ask warden about toll" reads as sprout.ask\n');
    expect(page).toContain('in yard, "pry crate" reads as lane.pry\n');
  });
});

describe('parseLine, for the standard library’s everyday phrasings', () => {
  it('reads `enter` and `go through` as `go`, and `talk to … about` as `ask`, each one verb', () => {
    for (const line of ['enter in', 'go through into the shed']) {
      expect(read(line).page, line).toContain(`"${line}" reads as sprout.go\n`);
    }
    expect(read('talk to warden about toll').page).toContain(
      '"talk to warden about toll" reads as sprout.ask\n',
    );
  });
});
