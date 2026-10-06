import { declaredId, Draft } from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { checkWorld } from './check.js';
import { standIn, type Standing } from '@overstory/sprout-player';
import { LANE, worldFolder } from '@overstory/sprout-player/fixtures';
import { inspectView } from './view.js';

const at = (place?: string): Standing =>
  standIn(checkWorld(worldFolder('lane', LANE)).bundle!, place === undefined ? {} : { at: place });

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
  turn shed to …  (lane.turn)
    notch: nothing it hears
  go out  (sprout.go)
  look  (sprout.look)
  inventory  (sprout.inventory)
  wait  (sprout.wait)
  help  (sprout.help)
  ask shed about …  (sprout.ask)
    topic: nothing it hears
`,
    });
  });

  it('names who else is there, greys a refused reading with its words, and gives value roles’ options', () => {
    const { page } = inspectView(at());
    expect(page).toContain('\nwho else is here\n  a warden (yard.warden)\n');
    expect(page).toContain('\n  pry crate  (lane.pry)\n    refused: The lid is nailed down.\n');
    expect(page).toContain('\n  turn dial to …  (lane.turn)\n    notch: 0 to 9\n');
    expect(page).toContain('\n  ask warden about …  (sprout.ask)\n    topic: toll, old road\n');
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
    const { page } = inspectView(standIn(checkWorld(boat).bundle!, {}));
    expect(page).toContain(
      '\n  take rowboat  (sprout.take)\n    refused: A rowboat cannot go inside itself.\n',
    );
    expect(page).toContain('\n  take pouch  (sprout.take)\n  drop pouch');
  });

  it('lists what the visitor carries', () => {
    const standing = at();
    const draft = new Draft(standing.state);
    draft.place(declaredId('lane', ['yard', 'brass_key']), standing.actor);
    const holding = { ...standing, state: draft.commit().state };
    expect(inspectView(holding).page).toContain('\ncarrying\n  a brass key (yard.brass_key)\n');
  });

  it('shows the world’s `unseen`, keeping the parts derived first, then the fault the host would log', () => {
    const standing = at();
    const { budgets } = standing.host;
    const starved = {
      ...standing,
      host: { ...standing.host, budgets: { ...budgets, pollSteps: 2 } },
    };
    const inspected = inspectView(starved);
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
`);
  });
});
