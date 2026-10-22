import { applyChanges } from '@overstory/sprout/core';
import { describe, expect, it } from 'vitest';

import { checkWorld } from './check.js';
import { standIn, type Standing } from '@overstory/sprout-player';
import { LANE, worldFolder } from '@overstory/sprout-player/fixtures';
import { inspectReadings, inspectScene, inspectView } from './view.js';

const lane = checkWorld(worldFolder('lane', LANE)).bundle!;

const at = (place?: string): Standing => standIn(lane, place === undefined ? {} : { at: place });
/** A visitor standing at `place`, their polls held to two steps. */
const starved = (place?: string): Standing =>
  standIn(lane, { ...(place === undefined ? {} : { at: place }), budgets: { pollSteps: 2 } });

describe('inspectView', () => {
  it('shows the description, the ways out, who else is there, what is carried and every reading', () => {
    expect(inspectView(at('shed'))).toEqual({
      ok: true,
      page: `standing in shed

description
  Tools hang in rows.

ways out
  exit out "back to the yard" -> yard

who else is here
  nobody

carrying
  nothing

what they could type
  pry shed  (lane.pry)
    target: a shed (shed)
  turn shed to …  (lane.turn)
    target: a shed (shed)
    notch: nothing it hears
  go out  (sprout.go)
    way: exit out "back to the yard" -> yard
  look  (sprout.look)
  examine shed  (sprout.examine)
    target: a shed (shed)
  inventory  (sprout.inventory)
  wait  (sprout.wait)
  help  (sprout.help)
  ask shed about …  (sprout.ask)
    target: a shed (shed)
    topic: nothing it hears
`,
    });
  });

  it('names who else is there, greys a refused reading with its words, and gives value roles’ options', () => {
    const { page } = inspectView(at());
    expect(page).toContain('\nwho else is here\n  a warden (yard.warden)\n');
    expect(page).toContain(
      '\n  pry crate  (lane.pry)\n    refused: The lid is nailed down.\n    target: a crate (yard.crate)\n',
    );
    expect(page).toContain(
      '\n  turn dial to …  (lane.turn)\n    target: a dial (yard.dial)\n    notch: 0 to 9\n',
    );
    expect(page).toContain(
      '\n  ask warden about …  (sprout.ask)\n    target: a warden (yard.warden)\n    topic: toll, old road\n',
    );
    expect(page).toContain('\n  give iron key to warden  (sprout.give)\n');
  });

  it('greys a reading whose move would put a thing inside itself with the world’s `inside_itself`', () => {
    const boat = worldFolder('boat', {
      'boat.sprout': `world boat is sprout.World {
  visitors are Walker
  visitors arrive at rowboat
  object rowboat is Rowboat { object pouch is sprout.Container }
}
kind Rowboat is sprout.Place { as target for take { do { } } }
`,
      'walker.sprout': 'kind Walker is sprout.Visitor { }\n',
    });
    const { page } = inspectView(standIn(checkWorld(boat).bundle!));
    expect(page).toContain(
      '\n  take rowboat  (sprout.take)\n    refused: A rowboat cannot go inside itself.\n',
    );
    expect(page).toContain(
      '\n  take pouch  (sprout.take)\n    target: a pouch (rowboat.pouch)\n    source: unbound\n  drop pouch',
    );
  });

  it('writes what fills each role beneath its reading: a thing, a set, a way out, and a value role only by its options', () => {
    const { page } = inspectView(standIn(checkWorld('../corpus/good/chip-tree').bundle!));
    expect(page).toContain(
      '\n  juggle pebble  (chip_tree.juggle)\n    things: a pebble (hall.pebble)\n',
    );
    expect(page).toContain(
      '\n  go north  (sprout.go)\n    way: exit north "to the yard" -> yard\n',
    );
    expect(page).toContain(
      '\n  ask guard about …  (sprout.ask)\n    target: a guard (hall.guard)\n    topic: bridge, toll, weather\n',
    );
    expect(page).not.toContain('topic: unbound');
  });

  it('lists what the visitor carries', () => {
    const standing = at();
    const took = standing.engine.command(standing.stored, {
      seed: 0,
      mayHold: null,
      now: 0,
      visit: standing.visit,
      text: 'take brass key',
    });
    const holding = { ...standing, stored: applyChanges(standing.stored, took.changes!) };
    expect(inspectView(holding).page).toContain('\ncarrying\n  a brass key (yard.brass_key)\n');
  });

  it('shows the world’s `unseen`, keeping the parts derived first, then the fault the host would log', () => {
    const inspected = inspectView(starved());
    expect(inspected.ok).toBe(false);
    expect(inspected.page).toBe(`standing in yard

description
  Something here is too much to take in.

ways out
  exit in "into the shed" -> shed

who else is here
  nobody

carrying
  nothing

what they could type
  nothing

the poll faulted, against yard, BudgetExhausted: pollSteps: a poll turn may take 2 steps.
A poll stops at its first step past 2, so how many this one needs is not known: give it more with --poll-steps, as in \`--poll-steps 4\`.
`);
  });
});

describe('inspectScene', () => {
  it('is the view’s page with the verbs it lists in place of the readings', () => {
    const standing = at('shed');
    const view = inspectView(standing).page;
    const scene = inspectScene(standing);
    expect(scene.ok).toBe(true);
    const place = view.slice(0, view.indexOf('what they could type'));
    expect(scene.page).toBe(`${place}verbs they could be offered
  lane.pry
  lane.turn
  sprout.go
  sprout.look
  sprout.examine
  sprout.inventory
  sprout.wait
  sprout.help
  sprout.ask
`);
  });

  it('shows the world’s `unseen` and the fault where the scene’s poll runs out', () => {
    const inspected = inspectScene(starved());
    expect(inspected.ok).toBe(false);
    expect(inspected.page).toContain('\ndescription\n  Something here is too much to take in.\n');
    expect(inspected.page).toMatch(
      /\nthe poll faulted, against yard, BudgetExhausted: pollSteps: a poll turn may take 2 steps\.\nA poll stops at its first step past 2, .*`--poll-steps 4`\.\n$/,
    );
  });
});

describe('inspectReadings', () => {
  it('gives each verb the scene lists the readings the whole view gives it, in the same order', () => {
    const standing = at();
    const view = inspectView(standing).page;
    const verbs = /verbs they could be offered\n((?: {2}\S+\n)+)/
      .exec(inspectScene(standing).page)![1]!
      .trim()
      .split(/\s+/);
    const readings = verbs.map((verb) => {
      const { ok, page } = inspectReadings(standing, verb);
      expect(ok).toBe(true);
      const heading = `what they could type with ${verb}\n`;
      expect(page.startsWith(`standing in yard\n\n${heading}`)).toBe(true);
      return page.slice(page.indexOf(heading) + heading.length);
    });
    expect(readings.join('')).toBe(view.slice(view.indexOf('what they could type\n') + 21));
  });

  it('says `nothing` for a verb the visitor can make no reading of, and faults with the budget', () => {
    expect(inspectReadings(at('shed'), 'sprout.take').page).toBe(
      'standing in shed\n\nwhat they could type with sprout.take\n  nothing\n',
    );
    const inspected = inspectReadings(starved('shed'), 'lane.pry');
    expect(inspected.ok).toBe(false);
    expect(inspected.page).toMatch(
      /^standing in shed\n\nwhat they could type with lane\.pry\n {2}nothing\n\nthe poll faulted, against shed, BudgetExhausted: /,
    );
  });
});

describe('a way drawn as it is taken', () => {
  const carousel = checkWorld(
    worldFolder('carousel', {
      'carousel.sprout': `world carousel is sprout.World {
  visitors are Walker
  visitors arrive at hub

  object hub is sprout.Place {
    grammar { exit west "west" -> one of (hall, refuse "No way.") }
    describe { text "The room turns." }
  }
  object hall is sprout.Place { }
}
`,
      'walker.sprout': 'kind Walker is sprout.Visitor { }\n',
    }),
  ).bundle!;

  it('is shown as one way out that leads nowhere until it is taken', () => {
    const { page } = inspectView(standIn(carousel, {}));
    expect(page).toContain('\nways out\n  exit west "west" -> one of (…)\n');
    expect(page).toContain('\n  go west  (sprout.go)\n    way: exit west "west" -> one of (…)\n');
  });
});
