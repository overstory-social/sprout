import { describe, expect, it } from 'vitest';

import { listenAt, secondsIn, sessionOptions } from './options.js';

describe('sessionOptions', () => {
  it('reads the seed, the file to record to, the turn cap and how far each turn moves time', () => {
    expect(
      sessionOptions({
        seed: '7',
        record: 'run.json',
        'turn-cap': '200',
        'advance-per-turn': '30s',
      }),
    ).toEqual({ seed: 7, record: 'run.json', turnCap: 200, advancePerTurn: 30 });
    expect(sessionOptions({}, () => 7)).toEqual({ seed: 7 });
  });

  it('seeds a session from the clock where no seed is given, as a whole number a seed may be', () => {
    expect(sessionOptions({}, () => 2 ** 32 + 41)).toEqual({ seed: 41 });
    expect(sessionOptions({ seed: '0' }, () => 99)).toEqual({ seed: 0 });
  });

  it('refuses each in words that say what to write instead', () => {
    expect(() => sessionOptions({ seed: 'x' })).toThrow('--seed wants a whole number: --seed 7');
    expect(() => sessionOptions({ seed: '4294967296' })).toThrow(
      '--seed wants a whole number from 0 to 4294967295: --seed 7',
    );
    expect(() => sessionOptions({ 'turn-cap': '0' })).toThrow(
      '--turn-cap wants a whole number from 1: --turn-cap 200',
    );
    expect(() => sessionOptions({ record: true })).toThrow('--record wants a file after it');
    expect(() => sessionOptions({ 'advance-per-turn': 'soon' })).toThrow(
      '--advance-per-turn wants how long each turn takes: --advance-per-turn 30s',
    );
  });
});

describe('secondsIn', () => {
  it('reads a duration short or long, and nothing else', () => {
    expect(secondsIn('30s')).toBe(30);
    expect(secondsIn('2m')).toBe(120);
    expect(secondsIn('1h')).toBe(3600);
    expect(secondsIn('40 minutes')).toBe(2400);
    expect(secondsIn('30')).toBeNull();
    expect(secondsIn('1.5h')).toBeNull();
    expect(secondsIn('3 fortnights')).toBeNull();
  });
});

describe('listenAt', () => {
  it('is stdio unless --http names a port, on loopback unless it names a host', () => {
    expect(listenAt({})).toEqual({ stdio: true });
    expect(listenAt({ http: '4711' })).toEqual({ host: '127.0.0.1', port: 4711 });
    expect(listenAt({ http: '0.0.0.0:4711' })).toEqual({ host: '0.0.0.0', port: 4711 });
    expect(() => listenAt({ http: true })).toThrow('--http wants where to listen');
    expect(() => listenAt({ http: 'here' })).toThrow('--http wants where to listen');
    expect(() => listenAt({ http: '70000' })).toThrow('--http wants where to listen');
  });
});
