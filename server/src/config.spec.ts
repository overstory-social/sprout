import { describe, expect, it } from 'vitest';

import { DEFAULT_BLESSED, DEFAULT_LIMITS } from '@overstory/sprout/lang';

import { readConfig } from './config.js';

const PATH = '/srv/sprout/server.toml';
const read = (text: string) => readConfig(text, PATH);
const problems = (text: string) => {
  const got = read(text);
  return 'problems' in got ? got.problems : [];
};

describe('the server’s config', () => {
  it('takes every key it leaves out from the spec’s defaults, a world’s folder from the config’s', () => {
    expect(read('[[worlds]]\npath = "./worlds/printers_shop"\n')).toEqual({
      config: {
        host: '127.0.0.1',
        port: 4700,
        logLevel: 'info',
        tickSeconds: 5,
        wakesWhileEmpty: false,
        worlds: ['/srv/sprout/worlds/printers_shop'],
        limits: DEFAULT_LIMITS,
        blessed: DEFAULT_BLESSED,
      },
    });
  });

  it('takes what it is given, a limit by its name among the caps or the budgets', () => {
    const got = read(
      [
        'listen = "0.0.0.0:5000"',
        'log_level = "debug"',
        'tick_seconds = 2',
        'wakes_while_empty = true',
        '[store]',
        'kind = "memory"',
        '[[worlds]]',
        'path = "/abs/world"',
        '[limits]',
        'steps = 1000',
        'phrasesPerVerb = 4',
      ].join('\n'),
    );
    if (!('config' in got)) throw new Error(got.problems.join('\n'));
    expect(got.config).toMatchObject({
      host: '0.0.0.0',
      port: 5000,
      logLevel: 'debug',
      tickSeconds: 2,
      wakesWhileEmpty: true,
      worlds: ['/abs/world'],
    });
    expect(got.config.limits.budgets.steps).toBe(1000);
    expect(got.config.limits.caps.phrasesPerVerb).toBe(4);
  });

  it('says where TOML is broken, by line and column', () => {
    expect(problems('listen = \n')).toEqual([
      expect.stringMatching(/^\/srv\/sprout\/server\.toml:1:\d+: /),
    ]);
  });

  it('names the line and the key of each value the schema refuses', () => {
    expect(problems('tick_seconds = 0\n[[worlds]]\npath = "w"\n')).toEqual([
      '/srv/sprout/server.toml:1: `tick_seconds` Too small: expected number to be >0.',
    ]);
    expect(problems('')).toEqual([
      expect.stringMatching(/^\/srv\/sprout\/server\.toml: `worlds` /),
    ]);
    expect(problems('colour = "blue"\n[[worlds]]\npath = "w"\n')).toHaveLength(1);
  });

  it('refuses a store kept on disk and extensions, which this build has not', () => {
    expect(problems('[store]\nkind = "sqlite"\n[[worlds]]\npath = "w"\n')).toEqual([
      '/srv/sprout/server.toml:2: `store.kind` is `memory` in this build: a store kept on disk is not in it yet.',
    ]);
    expect(
      problems('[[worlds]]\npath = "w"\n[extensions]\nmedia = { major = 1, module = "./m.js" }\n'),
    ).toEqual([
      '/srv/sprout/server.toml: `extensions` installs extensions, which this build of the server does not load yet.',
    ]);
  });

  it('refuses a limit that is not one, naming it', () => {
    expect(problems('[[worlds]]\npath = "w"\n[limits]\nstepz = 5\n')).toEqual([
      '/srv/sprout/server.toml:4: `limits.stepz` is not a limit.',
    ]);
  });
});
