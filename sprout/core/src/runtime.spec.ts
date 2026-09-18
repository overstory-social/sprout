import { describe, expect, it } from 'vitest';

import { MEDIA, shownMedia } from '@overstory/sprout-ext-media';
import type { Archive } from '@overstory/sprout';

import { SproutError } from './errors.js';
import { memoryStore } from './memory-store.js';
import { createRuntime } from './runtime.js';
import { testWorld } from './testing.js';
import type { TurnResponse } from './turn.js';

// The runtime (§4): load an archive, then turn. These are the turn and
// load contracts on the memory store — what stage 2a proves. Storage is
// the adapters' (2b, 3).

const NOW = new Date('2026-09-18T12:00:00Z');
const later = (s: number) => new Date(NOW.getTime() + s * 1000);

const ARCHIVE: Archive = {
  manifest: { format: 1, language: 1, entry: 'hall', extensions: ['media'] },
  files: [
    {
      name: 'kinds.sprout',
      source: `kind Cup {
  :names ["cup"]
  :takeable true
  on :spawned (from) { say "A cup, still wet." }
}
`,
    },
    {
      name: 'hall.sprout',
      source: `use media
room hall {
  :name "The Hall"
  :lit false
  prose "A hall. A door leads down."
  describe {
    if (self.get(:lit)) { text "A hall, bright now. A door leads down." }
    else { text "A hall. A door leads down." }
  }
  exit "down" to cellar
  on :lantern_lit { self.set(:lit, true) }
}
object lantern in hall {
  :name "Brass lantern"
  :names ["lantern"]
  :lit false
  :takeable true
  :remembers [has_lit: false]
  :image media "m-lantern"
  prose "A brass lantern, dark."
  describe {
    if (self.get(:lit)) { text "It burns." show self }
    else { text "A brass lantern, dark." }
  }
  light when (!self.get(:lit)) {
    self.set(:lit, true)
    actor.remember(:has_lit, true)
    say "The wick catches."
    send room :lantern_lit
  }
}
object wheel in hall {
  :name "Potter's wheel"
  :names ["wheel"]
  throw { spawn Cup in room  say "You throw a cup." }
  loop { send self :loop }
  on :loop { send self :loop }
}
`,
    },
    {
      name: 'cellar.sprout',
      source: `room cellar {
  prose "Dark and cold."
  exit "up" to hall
}
object chest: Container in cellar { :open false }
object coin in chest { :takeable true }
`,
    },
  ],
};

const runtimeWith = () => createRuntime({ store: memoryStore(), ext: MEDIA, presenceMs: 30_000 });
const marta = { id: 'p-marta', name: 'marta' };
const dana = { id: 'p-dana', name: 'dana' };
const texts = (r: TurnResponse) =>
  r.lines.map((l) => (l.kind === 'effect' ? `[${l.kind}]` : `${l.kind}: ${l.text}`));

describe('load', () => {
  it('compiles leniently, stores the archive, reports absent and warnings; a second load keeps the state that still fits', async () => {
    const rt = runtimeWith();
    const report = await rt.load('w', ARCHIVE, NOW);
    expect(report).toMatchObject({ microworldId: 'w', absent: [], dropped: [] });
    expect(report.stamp).toMatch(/^[0-9a-f]{8}$/);
    // play a little, then reload with the coin gone from the archive
    await rt.turn({ microworldId: 'w', actor: marta, input: { kind: 'enter' }, now: NOW });
    await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'light the lantern' },
      now: later(1),
    });
    const trimmed: Archive = {
      ...ARCHIVE,
      files: ARCHIVE.files.map((f) =>
        f.name === 'cellar.sprout'
          ? { ...f, source: 'room cellar {\n  prose "Dark and cold."\n  exit "up" to hall\n}\n' }
          : f,
      ),
    };
    const again = await rt.load('w', trimmed, later(2));
    expect(again.dropped).toEqual([]);
    const snap = await rt.snapshot('w', 'lantern');
    expect(snap.state).toMatchObject({ lit: true }); // kept: it still fits
    await expect(rt.snapshot('w', 'coin')).rejects.toMatchObject({ code: 'not-loaded' });
  });

  it('refuses what a limit forbids, a newer language, an extension the runtime lacks — as SproutError codes', async () => {
    const rt = runtimeWith();
    await expect(rt.load('w', ARCHIVE, NOW, { limits: { rooms: 1 } })).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
    await expect(
      rt.load('w', { ...ARCHIVE, manifest: { ...ARCHIVE.manifest!, language: 99 } }, NOW),
    ).rejects.toMatchObject({ code: 'language-too-new' });
    const plain = createRuntime({ store: memoryStore() });
    await expect(plain.load('w', ARCHIVE, NOW)).rejects.toMatchObject({
      code: 'no-such-extension',
    });
    // compile outcomes are returned, never thrown: a broken file is absent, not an error
    const broken = await rt.load('b', { files: [{ name: 'x.sprout', source: 'room {' }] }, NOW);
    expect(broken.absent[0]?.reason).toContain('does not parse');
    await expect(
      rt.turn({ microworldId: 'nope', actor: marta, input: { kind: 'enter' }, now: NOW }),
    ).rejects.toBeInstanceOf(SproutError);
  });
});

describe('the turn', () => {
  it('enter: the door, a room block, chips with tokens; look: a read turn that answers null for a known stamp', async () => {
    const rt = runtimeWith();
    await rt.load('w', ARCHIVE, NOW);
    const entered = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'enter' },
      now: NOW,
    });
    expect(entered.scene?.room).toEqual({
      id: 'hall',
      name: 'The Hall',
      prose: 'A hall. A door leads down.',
      entry: true,
    });
    expect(entered.lines.map((l) => l.kind)).toEqual(['room']);
    expect(entered.lines[0]?.text).toContain("You can see brass lantern, potter's wheel here.");
    expect(entered.scene?.exits).toEqual([{ label: 'down', to: 'cellar' }]);
    expect(entered.scene?.items.map((i) => i.name)).toEqual(['Brass lantern', "Potter's wheel"]);
    expect(entered.affordances.actions.map((a) => a.label)).toEqual([
      'Light — Brass lantern',
      'take — Brass lantern',
      "Throw — Potter's wheel",
      "Loop — Potter's wheel",
      'down',
    ]);
    expect(entered.affordances.nouns.map((a) => a.label)).toEqual([
      'Brass lantern',
      "Potter's wheel",
    ]);
    for (const a of [...entered.affordances.actions, ...entered.affordances.nouns]) {
      expect(a.token.startsWith(`${entered.scene!.stamp}.`)).toBe(true);
    }
    const poll = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'look' },
      now: later(1),
      knownStamp: entered.scene!.stamp,
    });
    expect(poll).toEqual({ lines: [], scene: null, affordances: entered.affordances });
    // not entered: a refusal, never a throw
    const stranger = await rt.turn({
      microworldId: 'w',
      actor: dana,
      input: { kind: 'say', text: 'look' },
      now: later(1),
    });
    expect(texts(stranger)).toEqual(['refused: You are not anywhere yet. Enter first.']);
  });

  it('say: a verb changes state, remembers the visitor, the room answers, an effect rides the lines, an action is recorded; a miss is a miss line', async () => {
    const rt = runtimeWith();
    await rt.load('w', ARCHIVE, NOW);
    await rt.turn({ microworldId: 'w', actor: marta, input: { kind: 'enter' }, now: NOW });
    const lit = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'light the lantern' },
      now: later(1),
    });
    expect(texts(lit)).toEqual(['said: The wick catches.']);
    expect(lit.scene?.room.prose).toBe('A hall, bright now. A door leads down.');
    expect(lit.scene?.items[0]?.prose).toBe('It burns.');
    expect(lit.scene?.memory).toEqual([
      { object: 'Brass lantern', fields: [{ name: 'has_lit', value: true }] },
    ]);
    expect(lit.affordances.actions.map((a) => a.label)).not.toContain('Light — Brass lantern');
    // examining shows the picture: an effect line, and nowhere else
    const looked = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'x lantern' },
      now: later(2),
    });
    expect(looked.lines.map((l) => l.kind)).toEqual(['said', 'effect']);
    expect(shownMedia(looked.lines.flatMap((l) => (l.effect ? [l.effect] : [])))).toEqual([
      'm-lantern',
    ]);
    const missed = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'juggle the lantern' },
      now: later(3),
      options: { keepMissText: true },
    });
    expect(texts(missed)).toEqual(['miss: I don\'t know the word "juggle" here.']);
    const report = await rt.inspect('w', 'owner', later(9));
    expect(report.misses.map((m) => m.input)).toEqual(['juggle the lantern']);
    // a miss without the switch leaves an action with `missed`, and no text
    const quiet = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'dance' },
      now: later(3),
    });
    expect(texts(quiet)[0]).toMatch(/^miss:/);
    expect((await rt.inspect('w', 'owner', later(9))).misses).toHaveLength(1);
    expect(report.misses[0]?.couldSay).toContain('light brass lantern');
    // the memory survives a reload of the page: enter again prints the last narration
    const back = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'enter' },
      now: later(4),
    });
    expect(back.scene?.memory[0]?.object).toBe('Brass lantern');
    await rt.forget({ microworldId: 'w', actorId: marta.id, now: later(5) });
    const forgotten = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'look' },
      now: later(6),
    });
    expect(forgotten.scene?.memory).toEqual([]);
  });

  it('chips: a token is resolved against the scene it was minted for; a stale one is refused', async () => {
    const rt = runtimeWith();
    await rt.load('w', ARCHIVE, NOW);
    const entered = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'enter' },
      now: NOW,
    });
    const take = entered.affordances.actions.find((a) => a.label === 'take — Brass lantern')!;
    const taken = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'chip', token: take.token },
      now: later(1),
    });
    expect(taken.scene?.carrying.map((i) => i.name)).toEqual(['Brass lantern']);
    expect(taken.scene?.items.map((i) => i.name)).toEqual(["Potter's wheel"]);
    expect(taken.affordances.actions.map((a) => a.label)).toContain('drop — Brass lantern');
    // the old token names a scene that is gone
    const stale = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'chip', token: take.token },
      now: later(2),
    });
    expect(texts(stale)).toEqual(['refused: That is not something you can do here now.']);
    const forged = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'chip', token: 'deadbeef.0' },
      now: later(3),
    });
    expect(texts(forged)).toEqual(['refused: That is not something you can do here now.']);
  });

  it('go: through an exit into the next room, with a room block; a closed way is refused', async () => {
    const rt = runtimeWith();
    await rt.load('w', ARCHIVE, NOW);
    await rt.turn({ microworldId: 'w', actor: marta, input: { kind: 'enter' }, now: NOW });
    const down = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'go down' },
      now: later(1),
    });
    expect(down.scene?.room.id).toBe('cellar');
    expect(down.lines.map((l) => l.kind)).toEqual(['room']);
    // the chest is shut: the coin inside is not listed, and cannot be taken
    expect(down.scene?.items.map((i) => i.name)).toEqual(['Chest']);
    const coin = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'take the coin' },
      now: later(2),
    });
    expect(texts(coin)[0]).toMatch(/^(miss|refused):/);
    const nowhere = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'go sideways' },
      now: later(3),
    });
    expect(texts(nowhere)).toEqual(["miss: You can't go that way."]);
    // a reload puts her back in the cellar, where she stood
    const again = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'enter' },
      now: later(4),
    });
    expect(again.scene?.room.id).toBe('cellar');
  });

  it('spawn: a thing made in a turn gets its id from the store and lives on; a fault rolls back and records the action', async () => {
    const rt = runtimeWith();
    await rt.load('w', ARCHIVE, NOW);
    await rt.turn({ microworldId: 'w', actor: marta, input: { kind: 'enter' }, now: NOW });
    const thrown = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'throw the wheel' },
      now: later(1),
    });
    expect(texts(thrown)).toEqual(['said: You throw a cup.', 'said: A cup, still wet.']);
    expect(thrown.scene?.items.map((i) => i.name)).toEqual([
      'Brass lantern',
      "Potter's wheel",
      'Cup',
    ]);
    const cupId = thrown.scene!.items[2]!.id;
    expect(cupId).toMatch(/^spawn-\d+$/);
    // the cup is a real thing: it can be taken
    const took = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'take the cup' },
      now: later(2),
    });
    expect(took.scene?.carrying.map((i) => i.id)).toEqual([cupId]);
    // a fault: the wheel's loop answers itself without end
    const looped = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'loop the wheel' },
      now: later(3),
    });
    expect(texts(looped)).toEqual([
      'fault: Something here tangles itself up, and nothing happens.',
    ]);
    expect(looped.scene?.carrying.map((i) => i.id)).toEqual([cupId]); // nothing rolled forward
    // §4.5-3: nothing of the world was written — the object rows are as before — but the
    // action landed and the actor's own row was touched (a notice queued earlier is drained).
    expect((await rt.snapshot('w', 'wheel')).state).toEqual({});
    const report = await rt.inspect('w', 'operator', later(9));
    expect(report.faults).toHaveLength(1);
    // presence is the window, not forever: marta was last seen at +3s, the window is 30s
    expect((await rt.inspect('w', 'owner', later(60))).present).toBe(0);
    expect(report.faults[0]).toMatchObject({ command: 'loop the wheel' });
    expect(report.faults[0]?.chain?.length).toBeGreaterThan(0);
    const owner = await rt.inspect('w', 'owner', later(9));
    expect(owner.faults[0]).not.toHaveProperty('chain');
    expect(owner.present).toBe(1);
    expect(owner).not.toHaveProperty('presentActors');
    expect(report.presentActors).toEqual([{ id: 'p-marta', name: 'marta' }]);
  });

  it('company: presence, notices queued for the other, give across hands, leave', async () => {
    const rt = runtimeWith();
    await rt.load('w', ARCHIVE, NOW);
    await rt.turn({ microworldId: 'w', actor: marta, input: { kind: 'enter' }, now: NOW });
    await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'take the lantern' },
      now: later(1),
    });
    const danaIn = await rt.turn({
      microworldId: 'w',
      actor: dana,
      input: { kind: 'enter' },
      now: later(2),
    });
    expect(danaIn.scene?.present).toEqual([{ id: 'p-marta', name: 'marta' }]);
    expect(danaIn.lines[0]?.text).toContain('Also here: marta.');
    // marta's next poll hears dana arrive
    const heard = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'look' },
      now: later(3),
    });
    expect(texts(heard)).toEqual(['notice: dana arrives.']);
    expect(heard.scene?.present).toEqual([{ id: 'p-dana', name: 'dana' }]);
    expect(heard.affordances.actions.map((a) => a.label)).toContain('give — Brass lantern to dana');
    const gave = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'give the lantern to dana' },
      now: later(4),
    });
    expect(gave.scene?.carrying).toEqual([]);
    const danaLook = await rt.turn({
      microworldId: 'w',
      actor: dana,
      input: { kind: 'look' },
      now: later(5),
    });
    expect(danaLook.scene?.carrying.map((i) => i.name)).toEqual(['Brass lantern']);
    // presence expires; leave ends it at once
    const gone = await rt.turn({
      microworldId: 'w',
      actor: dana,
      input: { kind: 'leave' },
      now: later(6),
    });
    expect(gone.scene).toBeNull();
    const alone = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'look' },
      now: later(7),
    });
    expect(texts(alone)).toEqual(['notice: dana leaves.']);
    expect(alone.scene?.present).toEqual([]);
    // a name is capped and trimmed, never thrown on
    const long = await rt.turn({
      microworldId: 'w',
      actor: { id: 'p-x', name: '  ' + 'x'.repeat(200) },
      input: { kind: 'enter' },
      now: later(8),
    });
    expect(long.scene).not.toBeNull();
    const seen = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'look' },
      now: later(9),
    });
    expect(seen.scene?.present[0]?.name.length).toBe(80);
  });

  it('reset puts the world back to the archive; memory stays; destroy takes everything; export/forget reach the visitor everywhere', async () => {
    const rt = runtimeWith();
    await rt.load('w', ARCHIVE, NOW);
    await rt.load('v', ARCHIVE, NOW);
    await rt.turn({ microworldId: 'w', actor: marta, input: { kind: 'enter' }, now: NOW });
    await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'say', text: 'light the lantern' },
      now: later(1),
    });
    await rt.turn({ microworldId: 'v', actor: marta, input: { kind: 'enter' }, now: later(1) });
    await rt.reset('w', later(2));
    expect((await rt.snapshot('w', 'lantern')).state).toMatchObject({ lit: false });
    const after = await rt.turn({
      microworldId: 'w',
      actor: marta,
      input: { kind: 'look' },
      now: later(3),
    });
    expect(after.scene?.memory).toEqual([
      { object: 'Brass lantern', fields: [{ name: 'has_lit', value: true }] },
    ]);
    const exported = await rt.exportActor(marta.id);
    expect(exported.actors.map((a) => a.microworldId).sort()).toEqual(['v', 'w']);
    await rt.forgetActor(marta.id, later(4));
    expect((await rt.exportActor(marta.id)).actors).toEqual([]);
    await rt.destroyMicroworld('w', later(5));
    await expect(rt.inspect('w', 'owner', later(6))).rejects.toMatchObject({
      code: 'no-such-microworld',
    });
    await rt.trim(later(6));
  });

  it('complete offers what could be typed, from the same grammar, without a lock', async () => {
    const rt = runtimeWith();
    await rt.load('w', ARCHIVE, NOW);
    await rt.turn({ microworldId: 'w', actor: marta, input: { kind: 'enter' }, now: NOW });
    const { completions } = await rt.complete({
      microworldId: 'w',
      actor: marta,
      prefix: 'li',
      now: later(1),
    });
    expect(completions).toContain('light lantern');
    expect(
      (await rt.complete({ microworldId: 'w', actor: dana, prefix: 'li', now: later(1) }))
        .completions,
    ).toEqual([]);
  });
});

describe('testWorld', () => {
  it('is the ten lines a host’s test needs', async () => {
    const world = await testWorld(ARCHIVE, { ext: MEDIA });
    expect(world.report.absent).toEqual([]);
    const { lines } = await world.play('light the lantern');
    expect(lines).toEqual(['The wick catches.']);
    const other = await world.play('look', 'dana');
    expect(other.lines[0]).toContain('Also here: you.');
  });
});
