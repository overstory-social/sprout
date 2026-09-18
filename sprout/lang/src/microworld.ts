import { z } from 'zod';

import { LANGUAGE_LEVEL, isBuiltinField } from './definitions.js';
import { NO_EXTENSIONS, type ExtensionSet } from './extensions.js';
import {
  messageGrammar,
  reachableMessage,
  type BuiltinVerb,
  type GrammarToken,
} from './grammar.js';
import { BUILTIN_VERBS } from './grammar.js';
import {
  SPROUT_BUILTIN_KINDS,
  resolveDefinition,
  type ItemDefinition,
  type KindDefinition,
  type ResolvedDefinition,
  type RoomDefinition,
  type SproutDefinition,
  type SproutStatement,
} from './sprout.js';
import {
  checkTree,
  parseFile,
  usesOf,
  type ParsedDefinition,
  type SproutProblem,
} from './sprout-lang.js';

// Microworld compilation (the split proposal §3.3): an ARCHIVE of files —
// each any number of kinds, rooms and objects — compiled together into a
// PROGRAM. Identifiers resolve across files (`exit "up" to hall`,
// `object torch: Torch in cellar`); `use` is an archive-level fact, so
// every file compiles under one keyword set; delivery order is
// declaration order (files by name, definitions in file order). The same
// function serves the host's check and the runtime's load, by a flag:
// STRICT refuses anything unresolved with a problem naming the file;
// LENIENT drops what cannot be compiled or resolved into `absent` and
// keeps the rest running — an object of a missing kind is not there, a
// door to a missing room is not there, a file that does not parse
// contributes nothing. That is what makes a take-down safe: load the
// archive without the file, and nothing goes dark that did not depend
// on it.

/** `sprout.json`: what an archive says about itself. */
export const SproutManifest = z.object({
  /** The archive layout's version; 1 is this one. */
  format: z.literal(1),
  /** The language level the archive needs (§3.2). */
  language: z.number().int().min(1),
  /** The identifier of the room a visitor enters first. */
  entry: z.string().min(1),
  /** The extensions the files `use`; a host can refuse before compiling. */
  extensions: z.array(z.string()).default([]),
});
export type SproutManifest = z.infer<typeof SproutManifest>;

export interface ArchiveFile {
  /** The file's name, its path in the archive; files compile in name order. */
  name: string;
  source: string;
}

/** A microworld as it travels: files and, when it has one, the manifest. */
export interface Archive {
  files: readonly ArchiveFile[];
  manifest?: SproutManifest | null;
}

/** A problem with the file it is in and the definition it is about, when known. */
export interface MicroworldProblem extends SproutProblem {
  file: string | null;
  definition: string | null;
}

/** Something the program runs WITHOUT, and why (lenient mode only). */
export interface Absent {
  /** The identifier, kind name or file; what the reason is about. */
  definition: string;
  file: string | null;
  reason: string;
}

/** An object as the program holds it: its definition folded, and where it sits. */
export interface ProgramObject extends ResolvedDefinition {
  definition: ItemDefinition;
  ident: string;
  /** The room or container it sits in, by identifier. */
  placedIn: string;
  file: string;
}

export interface ProgramRoom {
  definition: RoomDefinition;
  ident: string;
  file: string;
}

/**
 * What the evaluator and a matcher read (§3.3): resolved definitions by
 * identifier, folded kind chains, the room graph, the complete grammar
 * table, the extension set, what is absent, and the values an
 * extension's types are given in the text.
 */
export interface Program {
  level: number;
  uses: readonly string[];
  entry: string | null;
  kinds: ReadonlyMap<string, KindDefinition>;
  /** Kind name, room identifier or object identifier → the file that defined it. */
  files: ReadonlyMap<string, string>;
  rooms: ReadonlyMap<string, ProgramRoom>;
  objects: ReadonlyMap<string, ProgramObject>;
  /** Object identifiers in declaration order: files by name, definitions in file order. */
  order: readonly string[];
  /** Owner identifier → message name → its complete tokenised lines, authored or defaulted. */
  grammar: ReadonlyMap<string, ReadonlyMap<string, readonly (readonly GrammarToken[])[]>>;
  builtins: readonly BuiltinVerb[];
  /** Extension value type → the literals the text gives properties of that type (a media id, say). */
  values: ReadonlyMap<string, readonly string[]>;
  absent: readonly Absent[];
}

export interface Compilation {
  program: Program;
  problems: MicroworldProblem[];
  warnings: string[];
  absent: Absent[];
}

export interface MicroworldOptions {
  /** Strict: every unresolved reference is a problem (a save, a check). Lenient: it is absent (a load). */
  strict: boolean;
  ext?: ExtensionSet;
  /** The level the archive was accepted at; a policy refusal newer than it is a warning. */
  acceptedLevel?: number;
}

/** A rooms map that answers every identifier with itself: exits resolve after the whole archive is read. */
class IdentityRooms extends Map<string, string> {
  override get(ident: string): string {
    return ident;
  }
  override has(): boolean {
    return true;
  }
}

/** The names every `send` and `broadcast` in a body names, recursively. */
function sentIn(body: readonly SproutStatement[], out: Set<string>): void {
  for (const s of body) {
    switch (s.kind) {
      case 'send':
      case 'broadcast':
        out.add(s.message);
        break;
      case 'if':
        sentIn(s.then, out);
        sentIn(s.else, out);
        break;
      case 'each':
        sentIn(s.body, out);
        break;
      default:
        break;
    }
  }
}

function messagesSentBy(def: SproutDefinition | KindDefinition): Set<string> {
  const out = new Set<string>();
  for (const m of def.messages) sentIn(m.body, out);
  for (const h of def.handlers) sentIn(h.body, out);
  for (const h of def.hooks) sentIn(h.body, out);
  sentIn(def.describe, out);
  return out;
}

interface Slot {
  parsed: ParsedDefinition;
  file: string;
}

/**
 * Compile an archive into a program. Files are read in name order;
 * `use` lines are unioned first so every file parses under one keyword
 * set; kinds are checked against every kind in the archive, rooms and
 * objects against the kinds and every message anyone sends; then exits,
 * kind chains and placement resolve with the whole microworld in view.
 */
export function compileMicroworld(archive: Archive, options: MicroworldOptions): Compilation {
  const ext = options.ext ?? NO_EXTENSIONS;
  const problems: MicroworldProblem[] = [];
  const warnings: string[] = [];
  const absent: Absent[] = [];
  const sortedFiles = [...archive.files].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const refuse = (
    file: string | null,
    definition: string | null,
    message: string,
    at?: { line: number; column: number },
  ) => {
    problems.push({
      line: at?.line ?? 1,
      column: at?.column ?? 1,
      message,
      level: null,
      file,
      definition,
    });
  };
  const drop = (
    definition: string,
    file: string | null,
    reason: string,
    at?: { line: number; column: number },
  ) => {
    if (options.strict) refuse(file, definition, reason, at);
    else absent.push({ definition, file, reason });
  };

  // --- the extension set: the union of every file's `use` lines and the manifest's ---
  const uses: string[] = [];
  const claim = (name: string, file: string | null) => {
    if (uses.includes(name)) return;
    if (!ext.has(name)) {
      refuse(file, null, `This host has no extension called "${name}".`);
      return;
    }
    uses.push(name);
  };
  for (const name of archive.manifest?.extensions ?? []) claim(name, null);
  for (const f of sortedFiles) for (const name of usesOf(f.source)) claim(name, f.name);
  if (archive.manifest && archive.manifest.language > LANGUAGE_LEVEL) {
    refuse(
      null,
      null,
      `This archive needs language level ${archive.manifest.language}; this compiler is level ${LANGUAGE_LEVEL}.`,
    );
  }

  // --- parse every file ---
  const slots: Slot[] = [];
  for (const f of sortedFiles) {
    const parsed = parseFile(f.source, { ext, rooms: new IdentityRooms(), presetUses: uses });
    if (parsed.problem) {
      if (options.strict) problems.push({ ...parsed.problem, file: f.name, definition: null });
      else
        absent.push({
          definition: f.name,
          file: f.name,
          reason: `${f.name} does not parse: ${parsed.problem.line}:${parsed.problem.column} ${parsed.problem.message}`,
        });
      continue;
    }
    for (const d of parsed.definitions) slots.push({ parsed: d, file: f.name });
  }

  // --- names: kinds capitalised and apart; rooms and objects share one namespace ---
  const kindTrees = new Map<string, Slot>();
  const objectTrees = new Map<string, Slot>();
  const keep: Slot[] = [];
  for (const slot of slots) {
    const tree = slot.parsed.tree;
    const at = { line: slot.parsed.line, column: slot.parsed.column };
    if (tree.role === 'kind') {
      const first = kindTrees.get(tree.kindName);
      if (first) {
        drop(
          tree.kindName,
          slot.file,
          `A kind called ${tree.kindName} is already defined in ${first.file}.`,
          at,
        );
        continue;
      }
      kindTrees.set(tree.kindName, slot);
    } else {
      const ident = tree.ident ?? '';
      const first = objectTrees.get(ident);
      if (first) {
        drop(
          ident,
          slot.file,
          `Something called ${ident} is already defined in ${first.file}.`,
          at,
        );
        continue;
      }
      objectTrees.set(ident, slot);
    }
    keep.push(slot);
  }

  // --- the checks, with the whole archive in view ---
  const kinds = new Map<string, KindDefinition>();
  for (const [name, slot] of kindTrees) kinds.set(name, slot.parsed.tree as KindDefinition);
  const sent = new Set<string>();
  for (const slot of keep) for (const m of messagesSentBy(slot.parsed.tree)) sent.add(m);
  const zoneMessages = [...sent];
  const checked = new Map<Slot, SproutDefinition | KindDefinition>();
  for (const slot of keep) {
    const at = { line: slot.parsed.line, column: slot.parsed.column };
    const tree = slot.parsed.tree;
    const who = tree.role === 'kind' ? tree.kindName : (tree.ident ?? '');
    const others =
      tree.role === 'kind' ? new Map([...kinds].filter(([k]) => k !== tree.kindName)) : kinds;
    const r = checkTree(
      tree,
      { ext, zoneKinds: others, zoneMessages, acceptedLevel: options.acceptedLevel },
      at,
    );
    warnings.push(...r.warnings.map((w) => `${slot.file}: ${who}: ${w}`));
    if (!r.definition) {
      if (options.strict) {
        for (const p of r.problems) problems.push({ ...p, file: slot.file, definition: who });
      } else {
        absent.push({
          definition: who,
          file: slot.file,
          reason: r.problems.map((p) => p.message).join(' '),
        });
      }
      if (tree.role === 'kind') kinds.delete(tree.kindName);
      continue;
    }
    checked.set(slot, r.definition);
  }
  // A kind that was dropped takes its children with it (lenient), or names them (strict).
  const kindOk = (name: string | null): boolean => {
    let cur = name;
    const seen = new Set<string>();
    while (cur !== null && !(SPROUT_BUILTIN_KINDS as readonly string[]).includes(cur)) {
      if (!kinds.has(cur) || seen.has(cur)) return false;
      seen.add(cur);
      cur = kinds.get(cur)!.inherit;
    }
    return true;
  };
  for (const [name, def] of [...kinds]) {
    if (!kindOk(def.inherit)) {
      const slot = kindTrees.get(name)!;
      drop(name, slot.file, `${name} inherits ${def.inherit}, which is not here.`, {
        line: slot.parsed.line,
        column: slot.parsed.column,
      });
      kinds.delete(name);
      checked.delete(slot);
    }
  }

  // --- rooms, objects, exits, placement ---
  const rooms = new Map<string, ProgramRoom>();
  const objects = new Map<string, ProgramObject>();
  const order: string[] = [];
  const values = new Map<string, string[]>();
  const noteValues = (def: SproutDefinition | KindDefinition) => {
    for (const p of def.properties) {
      if (isBuiltinField(p) || typeof p.default !== 'string' || p.default === '') continue;
      const list = values.get(p.type) ?? [];
      if (!list.includes(p.default)) list.push(p.default);
      values.set(p.type, list);
    }
  };
  for (const def of kinds.values()) noteValues(def);
  for (const slot of keep) {
    const def = checked.get(slot);
    if (!def || def.role === 'kind') continue;
    const at = { line: slot.parsed.line, column: slot.parsed.column };
    const ident = def.ident ?? '';
    if (!kindOk(def.inherit)) {
      drop(ident, slot.file, `${ident} is a ${def.inherit}, which is not here.`, at);
      continue;
    }
    noteValues(def);
    if (def.role === 'room') {
      rooms.set(ident, { definition: def, ident, file: slot.file });
      continue;
    }
    if (!def.placedIn) {
      drop(
        ident,
        slot.file,
        `${ident} sits nowhere: say where with \`in <room or container>\`.`,
        at,
      );
      continue;
    }
    const resolved = resolveDefinition(def, kinds);
    objects.set(ident, {
      ...resolved,
      definition: resolved.definition as ItemDefinition,
      ident,
      placedIn: def.placedIn,
      file: slot.file,
    });
    order.push(ident);
  }
  // Exits: to a room that exists, else gone.
  for (const room of rooms.values()) {
    const exits = room.definition.exits.filter((e) => {
      if (rooms.has(e.toRoomId)) return true;
      const slot = objectTrees.get(room.ident)!;
      drop(
        e.toRoomId,
        room.file,
        `No room is called "${e.toRoomId}" here (the exit "${e.label}" from ${room.ident}).`,
        { line: slot.parsed.line, column: slot.parsed.column },
      );
      return false;
    });
    if (exits.length !== room.definition.exits.length) {
      room.definition = { ...room.definition, exits };
    }
  }
  // Placement: a room, or an object that is a container; no cycles.
  const isContainerObject = (ident: string): boolean => {
    const obj = objects.get(ident);
    return !!obj && obj.definition.inherit === 'Container';
  };
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [ident, obj] of [...objects]) {
      const slot = objectTrees.get(ident)!;
      const at = { line: slot.parsed.line, column: slot.parsed.column };
      const target = obj.placedIn;
      let reason: string | null = null;
      if (rooms.has(target)) reason = null;
      else if (objects.has(target)) {
        if (!isContainerObject(target)) reason = `${ident} is in ${target}, which holds nothing.`;
        else {
          // a cycle: walking up must reach a room
          const seen = new Set<string>([ident]);
          let cur: string | undefined = target;
          while (cur && objects.has(cur) && !seen.has(cur)) {
            seen.add(cur);
            cur = objects.get(cur)!.placedIn;
          }
          if (!cur || !rooms.has(cur))
            reason = `${ident} is in ${target}, which never reaches a room.`;
        }
      } else reason = `${ident} is in ${target}, which is not here.`;
      if (reason) {
        drop(ident, slot.file, reason, at);
        objects.delete(ident);
        order.splice(order.indexOf(ident), 1);
        pruned = true;
      }
    }
  }

  // --- the entry ---
  let entry: string | null = null;
  if (archive.manifest) {
    if (rooms.has(archive.manifest.entry)) entry = archive.manifest.entry;
    else
      drop(
        archive.manifest.entry,
        null,
        `The manifest's entry room "${archive.manifest.entry}" is not here.`,
      );
  }

  // --- the grammar table ---
  const grammar = new Map<string, Map<string, GrammarToken[][]>>();
  const tableOf = (ident: string, def: SproutDefinition) => {
    const table = new Map<string, GrammarToken[][]>();
    for (const m of def.messages) if (reachableMessage(m)) table.set(m.name, messageGrammar(m));
    grammar.set(ident, table);
  };
  for (const room of rooms.values()) tableOf(room.ident, room.definition);
  for (const obj of objects.values()) tableOf(obj.ident, obj.definition);

  const files = new Map<string, string>();
  for (const [name, slot] of kindTrees) if (kinds.has(name)) files.set(name, slot.file);
  for (const room of rooms.values()) files.set(room.ident, room.file);
  for (const obj of objects.values()) files.set(obj.ident, obj.file);
  const program: Program = {
    level: LANGUAGE_LEVEL,
    uses,
    entry,
    kinds,
    files,
    rooms,
    objects,
    order,
    grammar,
    builtins: BUILTIN_VERBS,
    values,
    absent,
  };
  return { program, problems, warnings, absent };
}
