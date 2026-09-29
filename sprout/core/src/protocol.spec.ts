import { describe, expect, it } from 'vitest';

import { deliver, deliveryOf, sendView } from './delivery.js';
import { TEXT_ONLY } from './capabilities.js';
import { command, MARTA, seeded, tally } from './fixtures/tally.js';
import { clientMessageOf, ClientMessage, PROTOCOL, ServerMessage } from './protocol.js';
import { runCommand } from './turns.js';
import { runView } from './views.js';
import type { Effect, InstanceId, SeenView } from '@overstory/sprout/lang';

const TOKEN = 'a-token-of-sixteen-or-more';

describe('what a client may send', () => {
  it('is each message the protocol names, each with exactly its fields', () => {
    for (const message of [
      { t: 'hello', protocol: PROTOCOL, client: 'sprout-client', token: TOKEN, renders: [] },
      { t: 'admit', world: 'printers_shop', nickname: 'Marta' },
      { t: 'command', seq: 3, line: 'take key' },
      { t: 'poll', seq: 4 },
      { t: 'chat', line: 'hello all' },
      { t: 'levels', show: ['prose', 'error', 'info'] },
      { t: 'leave' },
      { t: 'ping' },
    ]) {
      expect(ClientMessage.safeParse(message).success, JSON.stringify(message)).toBe(true);
    }
  });

  it('refuses another protocol, a short token, a field it does not name, and a level there is not', () => {
    for (const message of [
      { t: 'hello', protocol: 'sprout.0', client: 'c', token: TOKEN, renders: [] },
      { t: 'hello', protocol: PROTOCOL, client: 'c', token: 'short', renders: [] },
      { t: 'command', seq: 1, line: 'take key', as: 'Ines' },
      { t: 'levels', show: ['verbose'] },
      { t: 'command', seq: -1, line: 'look' },
      { t: 'shout', line: 'hey' },
    ]) {
      expect(ClientMessage.safeParse(message).success, JSON.stringify(message)).toBe(false);
    }
  });
});

describe('a frame off the wire', () => {
  it('is the message it holds, or words saying what is wrong with it', () => {
    expect(clientMessageOf('{"t":"poll","seq":2}')).toEqual({ message: { t: 'poll', seq: 2 } });
    expect(clientMessageOf('not json')).toEqual({ malformed: 'This frame is not JSON.' });
    expect(clientMessageOf('{"t":"poll","seq":"two"}')).toMatchObject({
      malformed: expect.stringMatching(/^This frame is not one the protocol reads: `seq`: /),
    });
  });
});

describe('what a host sends', () => {
  it('holds a turn’s effects and a view as core delivers them', async () => {
    const { host } = tally();
    const store = await seeded(host);
    const turn = await runCommand(store, 'w', host, command('bump counter'));
    if (!turn.committed) throw new Error('the bump faulted');
    const effects = deliver(turn.effects, MARTA, TEXT_ONLY);
    expect(effects.length).toBeGreaterThan(0);
    expect(ServerMessage.safeParse({ t: 'effects', seq: 1, last: true, effects }).success).toBe(
      true,
    );
    const { view } = await runView(store, 'w', host, MARTA, 0);
    const sent = JSON.parse(JSON.stringify({ t: 'view', seq: 2, view: sendView(view, TEXT_ONLY) }));
    const parsed = ServerMessage.safeParse(sent);
    expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);
  });

  it('refuses a `refused` with no words a person can read, and a `bye` for no reason there is', () => {
    expect(
      ServerMessage.safeParse({ t: 'refused', stage: 'admit', reason: 'nickname', text: '' })
        .success,
    ).toBe(false);
    expect(ServerMessage.safeParse({ t: 'bye', reason: 'bored', text: 'Goodbye.' }).success).toBe(
      false,
    );
  });

  it('holds every shape core makes of an effect: prose words, an extension’s words and its payload', () => {
    const from = 'shop.hall.press' as InstanceId;
    const to = 'shop#1' as InstanceId;
    const extension: Effect = {
      kind: 'extension',
      extension: 'media',
      statement: 'show',
      payload: { url: 'a.png', size: [2, 3], alt: null, big: false },
      from,
      actor: null,
      to,
      visit: MARTA,
      paragraphs: ['A picture.'],
    };
    const prose: Effect = {
      kind: 'told',
      from,
      actor: to,
      to,
      visit: MARTA,
      paragraphs: ['Clack.'],
    };
    const granted = { payloads: new Map([['media', new Set(['show'])]]) };
    const effects = [
      deliveryOf(prose, TEXT_ONLY),
      deliveryOf(extension, TEXT_ONLY),
      deliveryOf(extension, granted),
    ];
    expect(effects.map((one) => one.as)).toEqual(['words', 'words', 'payload']);
    const parsed = ServerMessage.safeParse({ t: 'effects', seq: null, last: true, effects });
    expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);
    // Words that name an extension while the effect is prose, or none for an extension's, are not what core makes.
    const [words] = effects;
    expect(
      ServerMessage.safeParse({
        t: 'effects',
        seq: null,
        last: true,
        effects: [{ ...words, recorded: { extension: 'media', statement: 'show' } }],
      }).success,
    ).toBe(false);
  });

  it('holds every shape core makes of a view: exits, things, readings of each option, and recorded effects', () => {
    const view: SeenView = {
      description: ['A hall.'],
      effects: [
        { extension: 'media', statement: 'show', payload: ['a.png'], transcript: 'A picture.' },
      ],
      exits: [
        { direction: 'north', label: 'to the yard', to: 'shop.yard' as InstanceId },
        { direction: null, label: 'the back stair', to: 'shop.loft' as InstanceId },
      ],
      occupants: [{ id: 'shop#2' as InstanceId, name: 'Ines' }],
      carried: [{ id: 'shop.hall.key' as InstanceId, name: 'a key' }],
      readings: [
        {
          verb: 'shop.turn',
          typed: 'turn dial to …',
          refused: null,
          options: [{ role: 'notch', takes: 'integer', ranges: [{ min: 0, max: 9 }] }],
        },
        {
          verb: 'sprout.ask',
          typed: 'ask Oskar about …',
          refused: ['Oskar shrugs.'],
          options: [
            { role: 'topic', takes: 'symbol', options: [{ value: 'toll', words: 'toll' }] },
          ],
        },
      ],
    };
    for (const capabilities of [TEXT_ONLY, { payloads: new Map([['media', new Set(['show'])]]) }]) {
      const parsed = ServerMessage.safeParse({
        t: 'view',
        seq: 1,
        view: sendView(view, capabilities),
      });
      expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);
    }
  });
});
