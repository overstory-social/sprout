import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  UNDERSTORY_CASCADE_DEPTH,
  UNDERSTORY_DEFINITION_BYTES_MAX,
  UNDERSTORY_EFFECTS_PER_HANDLER,
  UNDERSTORY_ENUM_OPTIONS_MAX,
  UNDERSTORY_EVENT_BUDGET,
  UNDERSTORY_EXITS_PER_ROOM,
  UNDERSTORY_FAULT_CHAIN,
  UNDERSTORY_FIELDS_PER_OBJECT,
  UNDERSTORY_HANDLERS_PER_OBJECT,
  UNDERSTORY_MAX_INSTANCES,
  UNDERSTORY_NODE_DEPTH_MAX,
  UNDERSTORY_SPAWNS_PER_ACTION,
  UNDERSTORY_VERBS_PER_OBJECT,
} from './definitions.js';
import { compileSprout, compileSproutKind } from './sprout-lang.js';
import {
  SPROUT_ARGS_PER_MESSAGE,
  SPROUT_BUILTIN_KINDS,
  SPROUT_GRAMMAR_PER_MESSAGE,
  SPROUT_NAMES_MAX,
  SPROUT_RESERVED_MESSAGES,
  wellKnownFor,
} from './sprout.js';
import { sproutSkillExamples } from './sprout-skill.js';

// The README is the language spec a stranger reads first, and it is
// hand-written — so what it states as fact is pinned here to the
// compiler: its worked example is the skill's (compiled and printed by
// the compiler itself), every reserved name and built-in kind is named,
// every well-known property has a row, and each cap in its table is the
// constant's value. A cap that moves without the README moving fails
// the gate; a README claim the compiler contradicts is a bug in one of
// them, and this is where it is found.

const README = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'),
  'utf8',
);

/** The fenced ```sprout blocks, in order. */
const blocks = [...README.matchAll(/```sprout\n([\s\S]*?)```/g)].map((m) => m[1]!.trim());

describe('README.md, pinned to the compiler', () => {
  it('ends its language chapter with the skill’s own worked example, verbatim', () => {
    const { kind, item, room } = sproutSkillExamples();
    for (const example of [kind, item, room]) {
      expect(blocks).toContain(example.trim());
    }
  });

  it('every sprout block that is a whole source compiles', () => {
    // The fragments (a message on its own, a header list) are prose; a
    // block that opens with a header is a source and must compile —
    // against the kinds and rooms it names.
    const kinds = new Map();
    const torch = compileSproutKind(sproutSkillExamples().kind);
    kinds.set('Torch', torch.definition!);
    for (const block of blocks) {
      if (block.includes('…')) continue; // a sketch with placeholders, not a source
      const head = block.split(/\s/)[0];
      if (head === 'kind') {
        const r = compileSproutKind(block, { zoneKinds: kinds });
        expect(r.problems, block.slice(0, 40)).toEqual([]);
        kinds.set(r.definition!.kindName, r.definition!);
      } else if (head === 'room' || head === 'object') {
        const r = compileSprout(block, {
          zoneKinds: kinds,
          rooms: new Map([['hall', 'hall']]),
        });
        expect(r.problems, block.slice(0, 40)).toEqual([]);
      }
    }
  });

  it('names every reserved message and every built-in kind', () => {
    for (const name of SPROUT_RESERVED_MESSAGES) expect(README).toContain(`\`${name}\``);
    for (const kind of SPROUT_BUILTIN_KINDS) expect(README).toContain(`\`${kind}\``);
  });

  it('has a row for every well-known property, with its default', () => {
    const rows = README.slice(README.indexOf('well-known properties**'));
    for (const role of ['room', 'item'] as const) {
      for (const [name, field] of wellKnownFor({ role, inherit: null })) {
        const row = rows.split('\n').find((l) => l.startsWith(`| \`:${name}\``));
        expect(row, name).toBeDefined();
        expect(row).toContain(`| ${field.type} `);
        expect(row).toContain(
          String('default' in field && field.default !== null ? field.default : 'none'),
        );
      }
    }
  });

  it('states each cap as the constant’s value', () => {
    const table = README.slice(README.indexOf('| cap '), README.indexOf('At runtime an action'));
    const row = (label: string) => table.split('\n').find((l) => l.includes(label)) ?? '';
    expect(row('properties per object')).toContain(`| ${UNDERSTORY_FIELDS_PER_OBJECT} `);
    expect(row('messages per object')).toContain(`| ${UNDERSTORY_VERBS_PER_OBJECT} `);
    expect(row('handlers, hooks, pass rules')).toContain(
      `| ${UNDERSTORY_HANDLERS_PER_OBJECT} each`,
    );
    expect(row('statements in one body')).toContain(`| ${UNDERSTORY_EFFECTS_PER_HANDLER} `);
    expect(row('options in a')).toContain(`| ${UNDERSTORY_ENUM_OPTIONS_MAX} `);
    expect(row('`:names` per object')).toContain(`| ${SPROUT_NAMES_MAX}, `);
    expect(row('grammar lines per message')).toContain(`| ${SPROUT_GRAMMAR_PER_MESSAGE}, `);
    expect(row('arguments per message')).toContain(`| ${SPROUT_ARGS_PER_MESSAGE} `);
    expect(row('exits per room')).toContain(`| ${UNDERSTORY_EXITS_PER_ROOM}, `);
    expect(row('nesting depth')).toContain(`| ${UNDERSTORY_NODE_DEPTH_MAX} `);
    expect(row('a source')).toContain(`| ${UNDERSTORY_DEFINITION_BYTES_MAX / 1024} KB`);
    const faults = README.slice(README.indexOf('At runtime an action'));
    expect(faults).toContain(`**${UNDERSTORY_CASCADE_DEPTH} events deep**`);
    expect(faults).toContain(`**${UNDERSTORY_EVENT_BUDGET} events in one action**`);
    expect(faults).toContain(`**${UNDERSTORY_SPAWNS_PER_ACTION} spawns**`);
    expect(faults).toContain(`**${UNDERSTORY_MAX_INSTANCES} live instances**`);
    expect(faults).toContain(`last ${UNDERSTORY_FAULT_CHAIN}`);
  });
});
