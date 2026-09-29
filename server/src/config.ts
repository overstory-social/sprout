import { isAbsolute, resolve } from 'node:path';

import { parse, TomlError } from 'smol-toml';
import { z } from 'zod';

import {
  DEFAULT_BLESSED,
  DEFAULT_LIMITS,
  limitsFrom,
  LimitsError,
  type Level,
  type Limits,
  type RuntimeBudgets,
  type StaticCaps,
} from '@overstory/sprout/lang';

// The server's config (docs/design/sprout-server.md, Config): TOML, read
// with smol-toml and checked by a zod schema whose defaults are the spec's
// Limits, so every figure lives in one place and a key left out takes the
// spec's. A problem is said naming its line where the TOML gives one and
// its key where the schema does. A world's folder is resolved from the
// config's own folder. No secret is ever written here.

/** Where the server keeps state and the log. Only memory is in this build; see the working notes. */
const Store = z
  .object({
    kind: z.literal('memory', {
      error: 'is `memory` in this build: a store kept on disk is not in it yet',
    }),
  })
  .strict();

const Schema = z
  .object({
    listen: z
      .string()
      .regex(/^[^\s:]+:\d{1,5}$/, 'is an address and a port, as `127.0.0.1:4700`')
      .default('127.0.0.1:4700'),
    log_level: z.enum(['error', 'warning', 'info', 'debug']).default('info'),
    tick_seconds: z.number().int().positive().default(5),
    wakes_while_empty: z.boolean().default(false),
    store: Store.default({ kind: 'memory' }),
    worlds: z
      .array(z.object({ path: z.string().min(1) }).strict())
      .min(1, 'names at least one world to serve'),
    limits: z.record(z.string(), z.number().int().positive()).default({}),
    extensions: z
      .record(
        z.string(),
        z.object({ major: z.number().int().nonnegative(), module: z.string() }).strict(),
      )
      .default({}),
    blessed_libraries: z.array(z.string().min(1)).default([...DEFAULT_BLESSED]),
  })
  .strict();

/** What the server runs with. */
export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  /** The lowest level the server writes to its own log. */
  readonly logLevel: Exclude<Level, 'prose'>;
  readonly tickSeconds: number;
  readonly wakesWhileEmpty: boolean;
  /** Each world's folder, resolved. */
  readonly worlds: readonly string[];
  readonly limits: Limits;
  readonly blessed: ReadonlySet<string>;
}

/** A config read, or every problem with it, each in words that name where. */
export type ReadConfig =
  { readonly config: ServerConfig } | { readonly problems: readonly string[] };

/** `text`, the config file at `path`, read and checked. */
export function readConfig(text: string, path: string): ReadConfig {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    if (error instanceof TomlError) {
      return { problems: [`${path}:${error.line}:${error.column}: ${firstLine(error.message)}`] };
    }
    throw error;
  }
  const checked = Schema.safeParse(raw);
  if (!checked.success) {
    return {
      problems: checked.error.issues.map((issue) => {
        const key = issue.path.join('.');
        const line = lineOf(text, issue.path);
        return `${path}${line === null ? '' : `:${line}`}: \`${key || 'the config'}\` ${issue.message}.`;
      }),
    };
  }
  const read = checked.data;
  if (Object.keys(read.extensions).length > 0) {
    return {
      problems: [
        `${path}: \`extensions\` installs extensions, which this build of the server does not load yet.`,
      ],
    };
  }
  let limits: Limits;
  try {
    limits = limitsFrom(overridesOf(read.limits));
  } catch (error) {
    if (!(error instanceof LimitsError)) throw error;
    const line = lineOf(text, ['limits', error.limit]);
    const detail = error.message.slice(error.limit.length + 2);
    return {
      problems: [`${path}${line === null ? '' : `:${line}`}: \`limits.${error.limit}\` ${detail}`],
    };
  }
  const [host, port] = read.listen.split(':') as [string, string];
  const folder = resolve(path, '..');
  return {
    config: {
      host,
      port: Number(port),
      logLevel: read.log_level,
      tickSeconds: read.tick_seconds,
      wakesWhileEmpty: read.wakes_while_empty,
      worlds: read.worlds.map((world) =>
        isAbsolute(world.path) ? world.path : resolve(folder, world.path),
      ),
      limits,
      blessed: new Set(read.blessed_libraries),
    },
  };
}

/** `[limits]`, each figure a cap's or a budget's by its name; a name that is neither is left for `limitsFrom` to refuse. */
function overridesOf(figures: Readonly<Record<string, number>>) {
  const caps: Partial<Record<keyof StaticCaps, number>> = {};
  const budgets: Partial<Record<keyof RuntimeBudgets, number>> = {};
  for (const [name, figure] of Object.entries(figures)) {
    if (name in DEFAULT_LIMITS.budgets) budgets[name as keyof RuntimeBudgets] = figure;
    else caps[name as keyof StaticCaps] = figure;
  }
  return { caps, budgets };
}

/** The line a key is written on, found by its last name at a line's start; null where it is not written. */
function lineOf(text: string, path: readonly PropertyKey[]): number | null {
  const last = [...path].reverse().find((key): key is string => typeof key === 'string');
  if (last === undefined) return null;
  const at = text.split('\n').findIndex((line) => new RegExp(`^\\s*${last}\\s*=`).test(line));
  return at < 0 ? null : at + 1;
}

function firstLine(message: string): string {
  return message.split('\n')[0]!.trim();
}
