import { describe, expect, it } from 'vitest';

import { deliver, sendView } from './delivery.js';
import { TEXT_ONLY } from './capabilities.js';
import { command, MARTA, seeded, tally } from './fixtures/tally.js';
import { clientMessageOf, ClientMessage, PROTOCOL, ServerMessage } from './protocol.js';
import { runCommand } from './turns.js';
import { runView } from './views.js';

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
    expect(ServerMessage.safeParse({ t: 'effects', seq: 1, effects }).success).toBe(true);
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
});
