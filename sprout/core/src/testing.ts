import type { Archive, ExtensionSet } from '@overstory/sprout';

import { memoryStore } from './memory-store.js';
import { createRuntime, type LoadReport, type Runtime } from './runtime.js';
import type { TurnResponse } from './turn.js';

// `testWorld(archive)` (the split proposal §4.6): ten lines that make the
// README's "try it" real for a host's own tests — a runtime over the
// memory store with the archive loaded, and `play(line, as?)` that types
// a line as an actor and returns the lines that came back.

export interface TestWorld {
  runtime: Runtime;
  report: LoadReport;
  /** Type a line as `as` (default 'you'); an actor who has not entered is entered first. */
  play(line: string, as?: string): Promise<{ lines: string[]; response: TurnResponse }>;
  /** Advance the clock every turn is stamped with. */
  now: Date;
}

export async function testWorld(
  archive: Archive,
  options: { ext?: ExtensionSet; now?: Date } = {},
): Promise<TestWorld> {
  const runtime = createRuntime({
    store: memoryStore(),
    ...(options.ext ? { ext: options.ext } : {}),
  });
  const world: TestWorld = {
    runtime,
    report: await runtime.load('test', archive, options.now ?? new Date('2026-09-18T12:00:00Z')),
    now: options.now ?? new Date('2026-09-18T12:00:00Z'),
    async play(line, as = 'you') {
      const actor = { id: as, name: as };
      world.now = new Date(world.now.getTime() + 1000);
      const first = await runtime.turn({
        microworldId: 'test',
        actor,
        input: { kind: 'look' },
        now: world.now,
      });
      if (first.scene === null && first.lines.some((l) => l.kind === 'refused')) {
        await runtime.turn({
          microworldId: 'test',
          actor,
          input: { kind: 'enter' },
          now: world.now,
        });
      }
      const response = await runtime.turn({
        microworldId: 'test',
        actor,
        input: { kind: 'say', text: line },
        now: world.now,
      });
      return {
        lines: response.lines.filter((l) => l.kind !== 'effect').map((l) => l.text),
        response,
      };
    },
  };
  return world;
}
