import { describe, expect, it } from 'vitest';

import { completions, History, typedOf, verbsTyping } from './input.js';

describe('a typed line', () => {
  it('is a line for the world, or a client command after `/`', () => {
    expect(typedOf('  take key ')).toEqual({ world: 'take key' });
    expect(typedOf('/say hello all')).toEqual({ say: 'hello all' });
    expect(typedOf('/log debug')).toEqual({ log: 'debug' });
    expect(typedOf('/quit')).toEqual({ client: 'quit' });
    expect(typedOf('/reconnect')).toEqual({ client: 'reconnect' });
    expect(typedOf('')).toEqual({ nothing: true });
  });

  it('says what is wrong with a command it does not read', () => {
    expect(typedOf('/say')).toEqual({ unknown: 'Write what to say after it: /say hello' });
    expect(typedOf('/log loud')).toEqual({
      unknown: '`/log` takes a level: warning, info, debug.',
    });
    expect(typedOf('/dance')).toEqual({
      unknown: 'There is no `/dance`; `/help` lists the client’s commands.',
    });
  });
});

describe('completion', () => {
  it('offers the client’s commands after a `/`, and the world’s lines that begin with what is typed', () => {
    expect(completions('/l', [])).toEqual(['/log']);
    expect(completions('/', []).length).toBe(5);
    expect(completions('ta', ['take key', 'take coin', 'look', 'Take lamp'])).toEqual([
      'take key',
      'take coin',
      'Take lamp',
    ]);
    expect(completions('', ['look'])).toEqual([]);
  });
});

describe('the verbs whose readings completion asks for', () => {
  const VERBS = [
    { verb: 'sprout.take', phrases: ['take …', 'pick up …'] },
    { verb: 'sprout.put', phrases: ['put … in …'] },
    { verb: 'sprout.look', phrases: ['look'] },
    { verb: 'sprout.go', phrases: ['go …', '…'] },
  ];

  it('are each verb a phrase of which could begin what is typed, by its words before its first slot', () => {
    expect(verbsTyping('ta', VERBS)).toEqual(['sprout.take', 'sprout.go']);
    expect(verbsTyping('Pick u', VERBS)).toEqual(['sprout.take', 'sprout.go']);
    expect(verbsTyping('put key in b', VERBS)).toEqual(['sprout.put', 'sprout.go']);
    expect(verbsTyping('look', VERBS)).toEqual(['sprout.look', 'sprout.go']);
  });

  it('are none for a word no phrase begins with, nothing typed, or a client command', () => {
    expect(verbsTyping('lookout', VERBS.slice(0, 3))).toEqual([]);
    expect(verbsTyping('takes', VERBS.slice(0, 3))).toEqual([]);
    expect(verbsTyping('  ', VERBS)).toEqual([]);
    expect(verbsTyping('/log', VERBS)).toEqual([]);
  });
});

describe('the history', () => {
  it('walks back through what was typed, and forward to the line being written', () => {
    const history = new History();
    history.push('look');
    history.push('take key');
    history.push('take key');
    expect(history.up('dr')).toBe('take key');
    expect(history.up('take key')).toBe('look');
    expect(history.up('look')).toBe('look');
    expect(history.down()).toBe('take key');
    expect(history.down()).toBe('dr');
  });
});
