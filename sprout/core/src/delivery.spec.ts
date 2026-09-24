import { describe, expect, it } from 'vitest';

import { visitKey, type Effect, type InstanceId, type VisitKey } from '@overstory/sprout/lang';

import { negotiate, TEXT_ONLY, type ClientCapabilities } from './capabilities.js';
import { deliver, deliverWords, deliveryOf, sendView } from './delivery.js';
import {
  HALL,
  INES,
  LANTERN,
  MARTA,
  showroom,
  showroomCatalogue,
  showroomHost,
  typed,
} from './fixtures/showroom.js';
import { runCommand } from './turns.js';
import { runView } from './views.js';

const catalogue = showroomCatalogue();
const host = showroomHost(catalogue);

/** A client granted `slides.show`, as a graphical one would ask to be. */
function slideClient(): ClientCapabilities {
  const negotiation = negotiate(
    { renders: [{ extension: 'slides', major: 1, statements: ['show'] }] },
    catalogue.extensions,
  );
  if (!negotiation.accepted) throw new Error(negotiation.words);
  return negotiation.capabilities;
}

/** Light the lantern and project it as Marta, and give back the projection's effects. */
async function projected(): Promise<readonly Effect[]> {
  const store = await showroom(catalogue);
  const lit = await runCommand(store, 'w', host, typed(MARTA, 'light lantern'));
  if (!lit.committed) throw new Error(lit.fault.detail);
  const turn = await runCommand(store, 'w', host, typed(MARTA, 'project lantern'));
  if (!turn.committed) throw new Error(turn.fault.detail);
  return turn.effects;
}

describe('a turn’s effects, as one client is sent them', () => {
  it('sends a granted statement’s payload, and every prose effect as words, in order', async () => {
    const sent = deliver(await projected(), MARTA, slideClient());
    expect(sent.map((one) => [one.kind, one.as])).toEqual([
      ['said', 'words'],
      ['extension', 'payload'],
    ]);
    expect(sent[0]).toMatchObject({
      recorded: null,
      from: LANTERN,
      paragraphs: ['The lantern throws a picture on the sheet.'],
    });
    expect(sent[1]).toMatchObject({
      recorded: { extension: 'slides', statement: 'show' },
      from: LANTERN,
      payload: { caption: 'a ship in a storm' },
    });
    expect(sent[1]).not.toHaveProperty('paragraphs');
  });

  it('sends a client that was granted nothing each extension’s effect as its transcript line', async () => {
    const effects = await projected();
    const sent = deliver(effects, MARTA, TEXT_ONLY);
    expect(sent.map((one) => [one.kind, one.as])).toEqual([
      ['said', 'words'],
      ['extension', 'words'],
    ]);
    expect(sent[1]).toMatchObject({
      recorded: { extension: 'slides', statement: 'show' },
      paragraphs: ['[A slide: a ship in a storm]'],
    });
    expect(sent[1]).not.toHaveProperty('payload');
    expect(deliverWords(effects, MARTA)).toEqual(sent);
  });

  it('sends a visitor only what they read', async () => {
    const effects = await projected();
    const toInes = deliver(effects, INES, slideClient());
    // Ines is in the hall but the projection spoke only to Marta.
    expect(toInes).toEqual([]);
  });

  it('sends a refusal as words', async () => {
    const store = await showroom(catalogue);
    const turn = await runCommand(store, 'w', host, typed(MARTA, 'project lantern'));
    if (!turn.committed) throw new Error(turn.fault.detail);
    expect(deliver(turn.effects, MARTA, slideClient())).toMatchObject([
      { kind: 'refused', as: 'words', paragraphs: ['The lantern is cold.'] },
    ]);
  });
});

describe('a view, as one client is sent it', () => {
  it('sends what its description recorded as a payload or as its transcript, the rest as it is', async () => {
    const store = await showroom(catalogue);
    const { view } = await runView(store, 'w', host, MARTA, 0);
    const shown = sendView(view, slideClient());
    expect(shown.description).toEqual(['A dark hall with a sheet hung at one end.']);
    expect(shown.effects).toEqual([
      {
        extension: 'slides',
        statement: 'show',
        as: 'payload',
        payload: { caption: 'a moth, very large' },
      },
    ]);
    const read = sendView(view, TEXT_ONLY);
    expect(read.effects).toEqual([
      {
        extension: 'slides',
        statement: 'show',
        as: 'words',
        transcript: '[A slide: a moth, very large]',
      },
    ]);
    expect({ ...read, effects: [] }).toEqual({ ...view, effects: [] });
  });
});

describe('what every client is sent, over generated effects', () => {
  // A small deterministic stream, so a failure names its case.
  function* stream(seed: number) {
    let x = seed;
    for (;;) {
      x = (x * 48271) % 2147483647;
      yield x;
    }
  }
  const KINDS = ['said', 'told', 'refused', 'described', 'notice', 'extension'] as const;
  const STATEMENTS = [
    ['slides', 'show'],
    ['slides', 'fade'],
    ['media', 'show'],
  ] as const;
  const VISITS: VisitKey[] = [visitKey('v-a'), visitKey('v-b')];

  function effectsFrom(draw: () => number): Effect[] {
    const effects: Effect[] = [];
    const length = draw() % 12;
    for (let i = 0; i < length; i++) {
      const kind = KINDS[draw() % KINDS.length]!;
      const visit = VISITS[draw() % VISITS.length]!;
      const parts = {
        from: HALL,
        actor: null,
        to: `i-${visit}` as InstanceId,
        visit,
        paragraphs: [`line ${i}`],
      };
      if (kind !== 'extension') effects.push({ kind, ...parts });
      else {
        const [extension, statement] = STATEMENTS[draw() % STATEMENTS.length]!;
        effects.push({ kind, ...parts, extension, statement, payload: { i } });
      }
    }
    return effects;
  }

  it('sends each effect of the visit exactly once, in order, as words or as a granted payload', () => {
    const clients: ClientCapabilities[] = [
      TEXT_ONLY,
      slideClient(),
      { payloads: new Map([['media', new Set(['show'])]]) },
    ];
    for (let seed = 1; seed <= 300; seed++) {
      const numbers = stream(seed);
      const draw = () => numbers.next().value!;
      const effects = effectsFrom(draw);
      for (const client of clients) {
        for (const visit of VISITS) {
          const mine = effects.filter((effect) => effect.visit === visit);
          const sent = deliver(effects, visit, client);
          expect(sent).toHaveLength(mine.length);
          sent.forEach((one, i) => {
            const effect = mine[i]!;
            expect(one.kind).toBe(effect.kind);
            expect(one).toEqual(deliveryOf(effect, client));
            const granted =
              effect.kind === 'extension' &&
              (client.payloads.get(effect.extension)?.has(effect.statement) ?? false);
            if (one.as === 'payload') {
              expect(granted).toBe(true);
              expect(effect.kind === 'extension' && one.payload).toEqual(
                effect.kind === 'extension' && effect.payload,
              );
            } else {
              expect(granted).toBe(false);
              // Nothing sent as words is sent without them.
              expect(one.paragraphs).toEqual(effect.paragraphs);
            }
          });
        }
      }
    }
  });
});
