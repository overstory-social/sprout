import { describe, expect, it } from 'vitest';

import { serverLog } from './log.js';

const written = (lowest: 'error' | 'info' | 'debug', format: 'text' | 'json') => {
  const lines: string[] = [];
  const log = serverLog(
    lowest,
    format,
    () => 42,
    (line) => lines.push(line),
  );
  log.write('debug', 'a wake delivered', 'shop');
  log.write('info', 'served');
  log.write('error', 'a turn faulted', 'shop');
  return lines;
};

describe('the server’s log', () => {
  it('writes each record at its level or more severe, one to a line, stamped with the host’s time', () => {
    expect(written('info', 'text')).toEqual(['42 info: served', '42 error shop: a turn faulted']);
    expect(written('error', 'text')).toEqual(['42 error shop: a turn faulted']);
    expect(written('debug', 'text')).toHaveLength(3);
  });

  it('writes JSON, one object to a line, where it is asked to', () => {
    expect(written('info', 'json').map((line) => JSON.parse(line))).toEqual([
      { at: 42, level: 'info', text: 'served' },
      { at: 42, level: 'error', world: 'shop', text: 'a turn faulted' },
    ]);
  });
});
