import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MEDIA } from './fixtures/media.js';
import { SproutManifest, compileMicroworld, type Archive } from './microworld.js';
import type { KindDefinition, SproutDefinition, SproutStatement } from './sprout.js';

// The worked example (Eric, 2026-09-18): ONE complex microworld in the
// design area that shows off every language feature, kept compiling by
// this spec so it is always what the compiler accepts — the file to read
// when assessing the language for expressiveness. Its README lists what
// is proposed and not yet built.

const ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/design/sprout-worked-example',
);

function archive(): Archive {
  const manifest = SproutManifest.parse(
    JSON.parse(readFileSync(join(ROOT, 'sprout.json'), 'utf8')),
  );
  const files = readdirSync(ROOT)
    .filter((f) => f.endsWith('.sprout'))
    .sort()
    .map((name) => ({ name, source: readFileSync(join(ROOT, name), 'utf8') }));
  return { files, manifest };
}

function* statements(body: readonly SproutStatement[]): Generator<SproutStatement> {
  for (const s of body) {
    yield s;
    if (s.kind === 'if') {
      yield* statements(s.then);
      yield* statements(s.else);
    } else if (s.kind === 'each') yield* statements(s.body);
  }
}

function* bodies(def: SproutDefinition | KindDefinition): Generator<readonly SproutStatement[]> {
  yield def.describe;
  for (const m of def.messages) yield m.body;
  for (const h of def.handlers) yield h.body;
  for (const h of def.hooks) yield h.body;
  for (const c of def.consents) yield c.body;
}

describe('design/proposals/sprout-worked-example', () => {
  const { program, problems, warnings } = compileMicroworld(archive(), {
    strict: true,
    ext: MEDIA,
  });

  it('compiles strictly, with no problems and no warnings', () => {
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
    expect(program.entry).toBe('yard');
  });

  it('uses every statement the language has, and every construct', () => {
    const defs = [
      ...program.kinds.values(),
      ...[...program.rooms.values()].map((r) => r.definition),
      ...[...program.objects.values()].map((o) => o.definition),
    ];
    const kinds = new Set<string>();
    for (const def of defs)
      for (const body of bodies(def)) for (const s of statements(body)) kinds.add(s.kind);
    expect([...kinds].sort()).toEqual([
      'adjust',
      'allow',
      'broadcast',
      'destroy',
      'each',
      'ext',
      'if',
      'move',
      'refuse',
      'remember',
      'say',
      'send',
      'set',
      'spawn',
      'text',
    ]);
    const has = (pick: (d: SproutDefinition | KindDefinition) => boolean) => defs.some(pick);
    expect(has((d) => d.properties.some((p) => p.type === 'boolean'))).toBe(true);
    expect(has((d) => d.properties.some((p) => p.type === 'integer'))).toBe(true);
    expect(has((d) => d.properties.some((p) => p.type === 'enum'))).toBe(true);
    expect(has((d) => d.properties.some((p) => p.type === 'string'))).toBe(true);
    expect(has((d) => d.properties.some((p) => p.type === 'media'))).toBe(true);
    expect(has((d) => d.remembers.length > 0)).toBe(true);
    expect(
      has((d) =>
        d.messages.some((m) => m.args.length > 0 && m.grammar.length > 1 && m.when !== null),
      ),
    ).toBe(true);
    expect(has((d) => d.messages.some((m) => m.abstract))).toBe(true);
    expect(has((d) => d.hooks.length > 0)).toBe(true);
    expect(has((d) => d.passRules.length > 0)).toBe(true);
    // the three consent guards, each somewhere
    for (const guard of ['depart', 'release', 'accept']) {
      expect(has((d) => d.consents.some((c) => c.guard === guard))).toBe(true);
    }
    expect(
      [...program.kinds.values()].some((k) => k.inherit !== null && k.inherit !== 'Container'),
    ).toBe(true);
    // placement: in a room, and in a container in a room
    expect(program.objects.get('lump_a')?.placedIn).toBe('bin');
    expect(program.objects.get('bin')?.placedIn).toBe('shed');
    expect(program.rooms.size).toBe(3);
    expect(program.values.get('media')).toEqual(['m-yard']);
  });
});
