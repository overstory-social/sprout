import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogueOf,
  compileBundle,
  DEFAULT_BLESSED,
  DEFAULT_LIMITS,
  initialState,
  loadWorld,
  readStoredWorld,
  saveWorld,
  type Bundle,
  type StoredInstance,
  type StoredWorld,
} from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { freshStage, playStep } from '../play.js';
import { readScript } from '../script.js';
import { INSTALLED_EXTENSIONS } from '../installed.js';
import { readWorld } from '../world.js';

describe('the stored worlds the C runtime reads and writes back', () => {
  const corpus = join(dirname(fileURLToPath(import.meta.url)), '../../../corpus');
  const file = join(corpus, 'goldens/stored-worlds.json');
  /** Most states one transcript contributes: its first, its last, and evenly between. */
  const PER_TRANSCRIPT = 6;

  /** A corpus world, compiled as publishing compiles it. */
  const worldBundle = (name: string): Bundle => {
    const read = readWorld(join(corpus, 'good', name));
    return compileBundle(read.source!, {
      mode: 'publish',
      blessed: DEFAULT_BLESSED,
      extensions: INSTALLED_EXTENSIONS,
    }).bundle!;
  };

  /** A stored world in the canonical bytes: keys in the schema's order. */
  const canonical = (state: Parameters<typeof saveWorld>[0]): string =>
    JSON.stringify(readStoredWorld(saveWorld(state)));

  const dumps = (): string => {
    const initial: string[] = [];
    const played: string[] = [];
    for (const name of readdirSync(join(corpus, 'good')).sort()) {
      const bundle = worldBundle(name);
      initial.push(
        `${JSON.stringify(name)}:${canonical(initialState(catalogueOf(bundle, DEFAULT_LIMITS.caps)))}`,
      );
      const folder = join(corpus, 'good', name, 'transcripts');
      if (!existsSync(folder)) continue;
      for (const transcript of readdirSync(folder).sort()) {
        const script = readScript(readFileSync(join(folder, transcript), 'utf8'), transcript);
        const stage = freshStage(bundle);
        const states = script.steps.map((step, i) => {
          playStep(stage, step, `${transcript}, step ${i + 1}`);
          return canonical(stage.state);
        });
        const distinct = states
          .map((text, step) => ({ text, step }))
          .filter(({ text }, i, all) => i === 0 || text !== all[i - 1]!.text);
        const chosen = new Set<number>();
        for (let k = 0; k < Math.min(PER_TRANSCRIPT, distinct.length); k++) {
          chosen.add(Math.round((k * (distinct.length - 1)) / Math.max(1, PER_TRANSCRIPT - 1)));
        }
        for (const at of [...chosen].sort((a, b) => a - b)) {
          const { text, step } = distinct[at]!;
          played.push(
            `{"world":${JSON.stringify(name)},"transcript":${JSON.stringify(transcript)},"step":${step + 1},"stored":${text}}`,
          );
        }
      }
    }
    return `{\n"initial":{\n${initial.join(',\n')}\n},\n"played":[\n${played.join(',\n')}\n]\n}\n`;
  };

  it('is the golden: regenerate with SPROUT_WRITE_GOLDENS=1 and read the diff', () => {
    const text = dumps();
    if (process.env['SPROUT_WRITE_GOLDENS'] === '1') writeFileSync(file, text);
    expect(text).toBe(readFileSync(file, 'utf8'));
  }, 120_000);
  it('is the reopened golden: stored worlds edited against the world, as load reconciles them', () => {
    type Mutable<T> = { -readonly [K in keyof T]: T[K] };
    type Edit = (stored: Mutable<StoredWorld>, instances: Mutable<StoredInstance>[]) => boolean;
    const live = (instances: Mutable<StoredInstance>[]) =>
      instances.filter(
        (one) => one.made.from !== 'visitor' && Object.keys(one.properties).length > 0,
      );
    const edits: [string, Edit][] = [
      [
        'a declared object with nothing stored',
        (stored, instances) => {
          const gone = instances.find(
            (one) => one.made.from === 'declared' && !instances.some((o) => o.container === one.id),
          );
          if (gone === undefined) return false;
          stored.instances = instances.filter((one) => one !== gone);
          return true;
        },
      ],
      [
        'a property stored under another type',
        (_stored, instances) => {
          const one = live(instances)[0];
          if (one === undefined) return false;
          const name = Object.keys(one.properties)[0]!;
          one.properties = {
            ...one.properties,
            [name]: { ...one.properties[name]!, type: 'bogus' },
          };
          return true;
        },
      ],
      [
        'a property the kind does not declare, and a memory of one',
        (_stored, instances) => {
          const one = instances[0]!;
          one.properties = { ...one.properties, ghost: { type: 'integer', value: 1 } };
          one.memory = { ...one.memory, [one.id]: { ghost: { type: 'integer', value: 2 } } };
          return true;
        },
      ],
      [
        'an integer past its range and a list with a repeat',
        (_stored, instances) => {
          const one = live(instances).find((o) =>
            Object.values(o.properties).some((p) => p.type === 'integer'),
          );
          if (one === undefined) return false;
          const name = Object.keys(one.properties).find(
            (n) => one.properties[n]!.type === 'integer',
          )!;
          one.properties = { ...one.properties, [name]: { type: 'integer', value: 4_000_000_000 } };
          return true;
        },
      ],
      [
        'a spawn of a kind the world does not declare',
        (stored, instances) => {
          stored.serial += 1;
          stored.instances = [
            ...instances,
            {
              id: `${stored.world}#${stored.serial}`,
              made: { from: 'spawned', kind: `${stored.world}.Nowhere` },
              container: stored.world,
              arrival: stored.serial,
              properties: { odd: { type: 'integer', value: 7 } },
              links: {},
              wakes: [],
              memory: {},
              lastTick: null,
            },
          ];
          return true;
        },
      ],
      [
        'a destroyed declared object',
        (stored, instances) => {
          const leaf = instances.find(
            (one) => one.made.from === 'declared' && !instances.some((o) => o.container === one.id),
          );
          if (leaf === undefined) return false;
          stored.instances = instances.filter((one) => one !== leaf);
          stored.tombstones = [...stored.tombstones, leaf.id].sort();
          return true;
        },
      ],
      [
        'a reading of a verb the world does not declare',
        (stored) => {
          if (stored.visitors.length === 0) return false;
          stored.visitors = stored.visitors.map((v, i) =>
            i === 0
              ? { ...v, lastReading: { verb: { library: 'gone', name: 'nothing' }, bindings: [] } }
              : v,
          );
          return true;
        },
      ],
    ];
    const cases: string[] = [];
    for (const name of readdirSync(join(corpus, 'good')).sort()) {
      const folder = join(corpus, 'good', name, 'transcripts');
      if (!existsSync(folder)) continue;
      const bundle = worldBundle(name);
      const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
      const transcript = readdirSync(folder).sort()[0]!;
      const script = readScript(readFileSync(join(folder, transcript), 'utf8'), transcript);
      const stage = freshStage(bundle);
      script.steps.forEach((step, i) => playStep(stage, step, `${transcript}, step ${i + 1}`));
      const saved: StoredWorld = readStoredWorld(saveWorld(stage.state));
      for (const [what, edit] of edits) {
        const stored = JSON.parse(JSON.stringify(saved)) as Mutable<StoredWorld>;
        if (!edit(stored, [...stored.instances] as Mutable<StoredInstance>[])) continue;
        const input = readStoredWorld(stored);
        const loaded = loadWorld(input, catalogue);
        cases.push(
          JSON.stringify({
            world: name,
            edit: what,
            input,
            saved: readStoredWorld(saveWorld(loaded.state)),
            created: loaded.created,
            dormant: loaded.dormant,
            dropped: loaded.dropped.map((d) => [d.id, d.property, d.actor, d.why]),
            stranded: loaded.stranded,
          }),
        );
      }
    }
    const text = `[\n${cases.join(',\n')}\n]\n`;
    const reopened = join(corpus, 'goldens/stored-reopened.json');
    if (process.env['SPROUT_WRITE_GOLDENS'] === '1') writeFileSync(reopened, text);
    expect(text).toBe(readFileSync(reopened, 'utf8'));
  }, 120_000);
});
