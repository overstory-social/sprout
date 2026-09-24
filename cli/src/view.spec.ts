import { declaredId, Draft } from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { checkWorld } from './check.js';
import { standIn, type Standing } from './stand.js';
import { LANE, worldFolder } from './testing.js';
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
  examine shed  (sprout.examine)
  inventory  (sprout.inventory)
  wait  (sprout.wait)
  help  (sprout.help)
  take shed  (sprout.take)
  drop shed  (sprout.drop)
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

  it('lists what the visitor carries', () => {
    const standing = at();
    const draft = new Draft(standing.state);
    draft.place(declaredId('lane', ['yard', 'brass_key']), standing.actor);
    const holding = { ...standing, state: draft.commit().state };
    expect(inspectView(holding).page).toContain('\ncarrying\n  a brass key (yard.brass_key)\n');
  });

  it('shows the world’s `unseen` where the poll runs out, then the fault the host would log', () => {
    const standing = at();
    const { budgets } = standing.host;
    const starved = {
      ...standing,
      host: { ...standing.host, budgets: { ...budgets, pollSteps: 2 } },
    };
    const inspected = inspectView(starved);
    expect(inspected.ok).toBe(false);
    expect(inspected.page).toMatch(
      /^standing in yard\n\ndescription\n {2}Something here is too much to take in\.\n\nways out\n {2}none\n[^]*\nthe poll faulted, against yard, BudgetExhausted: pollSteps: /,
    );
  });
});
