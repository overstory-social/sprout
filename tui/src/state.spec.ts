import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '@overstory/sprout/core';

import { EMPTY, received, statusWords, visible, type ClientState } from './state.js';

const fold = (...messages: ServerMessage[]): ClientState => messages.reduce(received, EMPTY);

describe('what the client shows', () => {
  it('is the world’s prose by its kind, a payload by what recorded it, and chat styled apart', () => {
    const state = fold(
      { t: 'welcome', server: 's', worlds: [{ world: 'shop', granted: [], declined: [] }] },
      { t: 'admitted', world: 'shop', nickname: 'Marta', returning: false },
      {
        t: 'effects',
        seq: 1,
        last: true,
        effects: [
          {
            as: 'words',
            kind: 'said',
            recorded: null,
            from: 'a',
            actor: 'b',
            to: 'b',
            paragraphs: ['You take a key.', 'It is cold.'],
          },
          {
            as: 'payload',
            kind: 'extension',
            recorded: { extension: 'media', statement: 'show' },
            from: 'a',
            actor: null,
            to: 'b',
            payload: 1,
          },
        ],
      },
      { t: 'chat', from: 'Ines', line: 'hello' },
      { t: 'refused', stage: 'frame', reason: 'malformed', text: 'This frame is not JSON.' },
    );
    expect(state.worlds).toEqual(['shop']);
    expect(state.world).toBe('shop');
    expect(state.lines.map((line) => [line.kind, line.text])).toEqual([
      ['client', 'You are in shop as Marta.'],
      ['said', 'You take a key.\nIt is cold.'],
      ['extension', '[media show]'],
      ['chat', 'Ines: hello'],
      ['refused', 'This frame is not JSON.'],
    ]);
  });

  it('keeps the status line and what can be typed, and says why the connection closed', () => {
    const state = fold(
      {
        t: 'status',
        place: 'the cellar',
        exits: [
          { direction: 'up', label: 'the stair', to: 'x' },
          { direction: null, label: 'the back door', to: 'y' },
        ],
      },
      { t: 'offered', lines: ['take key'] },
      { t: 'bye', reason: 'stopping', text: 'The server is stopping.' },
    );
    expect(statusWords(state.status)).toBe('the cellar — exits: up, the back door');
    expect(statusWords(null)).toBe('');
    expect(state.offered).toEqual(['take key']);
    expect(state.closed).toBe('stopping');
  });

  it('shows a host record only at a level shown, prose always', () => {
    const state = fold(
      { t: 'record', level: 'info', text: 'step: sprout.take', at: 1 },
      { t: 'record', level: 'error', text: 'a command faulted', at: 1 },
      { t: 'chat', from: 'Ines', line: 'hi' },
    );
    expect(visible(state.lines, new Set(['prose', 'error'])).map((line) => line.text)).toEqual([
      'a command faulted',
      'Ines: hi',
    ]);
    expect(visible(state.lines, new Set(['prose', 'error', 'info']))).toHaveLength(3);
  });
});
