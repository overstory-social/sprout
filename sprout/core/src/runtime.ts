import {
  LANGUAGE_LEVEL,
  NO_EXTENSIONS,
  SPROUT_NAME_MAX,
  SPROUT_SPAWNS_PER_ACTION,
  SproutBudget,
  compileMicroworld,
  complete as completeCommand,
  describeWith,
  dictionary,
  parseCommand,
  runMove,
  runVerb,
  turnContext,
  whatYouCanSay,
  type Absent,
  type Archive,
  type Command,
  type ExtensionSet,
  type Outcome,
  type ParseContext,
  type Program,
  type Scene,
  type TurnContext,
} from '@overstory/sprout';

import { SproutError } from './errors.js';
import {
  Limits,
  type ActionRecord,
  type ActorExport,
  type ActorRecord,
  type MemoryRecord,
  type MicroworldRecord,
  type MissRecord,
  type ObjectRecord,
} from './records.js';
import {
  memoryAfter,
  microworldOf,
  rowsAfter,
  sceneFor,
  stampOf,
  type Microworld,
} from './scene.js';
import type { ReadTx, SproutStore, StoreTx } from './store.js';
import {
  effectLines,
  project,
  resolveToken,
  roomLines,
  type Action,
  type Projection,
  type TranscriptLine,
  type TurnRequest,
  type TurnResponse,
} from './turn.js';

// The runtime (the split proposal §4): load an archive, then turn. Core
// owns runtime state only — no drafts, no versions, no publishing, no
// schedule; a host loads what it wants played, when it wants it played,
// and a builder's draft is just another microworld under an id the host
// chooses. Core knows no identity: an actor is an id and a name the host
// supplies each turn.

export interface RuntimeOptions {
  store: SproutStore;
  /** The extensions installed — what a `use` line may name. */
  ext?: ExtensionSet;
  /** Defaults for every microworld's limits; `load` may override per microworld. */
  limits?: Partial<Limits>;
  /** The program cache: compiled archives by stamp. */
  cache?: { entries?: number };
  /** How long an actor counts as present after their last turn. */
  presenceMs?: number;
}

export interface LoadReport {
  microworldId: string;
  stamp: string;
  absent: Absent[];
  warnings: string[];
  /** Object rows dropped because nothing in the new archive answers for them. */
  dropped: string[];
}

export interface MicroworldReport {
  microworldId: string;
  stamp: string;
  files: string[];
  limits: Limits;
  absent: Absent[];
  orphans: string[];
  faults: { at: Date; roomId: string; command: string; message: string; chain?: unknown[] }[];
  /** Presence as a count for the owner; the operator's report names them. */
  present: number;
  presentActors?: { id: string; name: string }[];
  misses: MissRecord[];
}

export interface ObjectSnapshot {
  id: string;
  state: Record<string, unknown>;
}

export interface Runtime {
  load(
    microworldId: string,
    archive: Archive,
    now: Date,
    opts?: { limits?: Partial<Limits> },
  ): Promise<LoadReport>;
  reset(microworldId: string, now: Date): Promise<void>;
  destroyMicroworld(microworldId: string, now: Date): Promise<void>;
  inspect(microworldId: string, as: 'owner' | 'operator', now: Date): Promise<MicroworldReport>;
  snapshot(microworldId: string, objectId: string): Promise<ObjectSnapshot>;
  forgetActor(actorId: string, now: Date): Promise<void>;
  exportActor(actorId: string): Promise<ActorExport>;
  trim(now: Date): Promise<void>;
  turn(req: TurnRequest): Promise<TurnResponse>;
  complete(q: {
    microworldId: string;
    actor: { id: string; name: string };
    prefix: string;
    now: Date;
  }): Promise<{ completions: string[] }>;
  forget(q: { microworldId: string; actorId: string; now: Date }): Promise<void>;
}

const DEFAULT_PRESENCE_MS = 30_000;

function archiveStamp(archive: Archive): string {
  const files = [...archive.files].sort((a, b) => (a.name < b.name ? -1 : 1));
  return stampOf(JSON.stringify([files, archive.manifest ?? null, LANGUAGE_LEVEL]));
}

function nameOf(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length > SPROUT_NAME_MAX ? trimmed.slice(0, SPROUT_NAME_MAX) : trimmed;
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { store } = options;
  const ext = options.ext ?? NO_EXTENSIONS;
  const presenceMs = options.presenceMs ?? DEFAULT_PRESENCE_MS;
  const cacheMax = options.cache?.entries ?? 64;
  const programs = new Map<string, Program>();

  /** The program for a stored microworld: from the cache, or a lenient compile of its archive. */
  function programOf(m: MicroworldRecord): Program {
    const hit = programs.get(m.stamp);
    if (hit) {
      programs.delete(m.stamp);
      programs.set(m.stamp, hit);
      return hit;
    }
    const { program } = compileMicroworld(m.archive, {
      strict: false,
      ext,
      acceptedLevel: m.level,
    });
    if (programs.size >= cacheMax) programs.delete(programs.keys().next().value!);
    programs.set(m.stamp, program);
    return program;
  }

  async function loaded(
    tx: ReadTx,
    microworldId: string,
  ): Promise<{ m: MicroworldRecord; program: Program }> {
    const m = await tx.microworld();
    if (!m) throw new SproutError('no-such-microworld', microworldId);
    if (m.level > LANGUAGE_LEVEL) {
      throw new SproutError('language-too-new', `${microworldId} needs level ${m.level}`);
    }
    return { m, program: programOf(m) };
  }

  async function worldOf(
    tx: ReadTx,
    program: Program,
    actorId: string,
  ): Promise<{ world: Microworld; memory: MemoryRecord }> {
    const [rows, memory] = await Promise.all([tx.objects(), tx.memory(actorId)]);
    return { world: microworldOf(program, rows, memory, ext), memory };
  }

  /** Who else stood in `room` within the presence window. */
  async function presentIn(tx: ReadTx, room: string, actorId: string, now: Date) {
    const since = new Date(now.getTime() - presenceMs);
    return (await tx.actorsIn(room, since))
      .filter((a) => a.id !== actorId)
      .map((a) => ({ id: a.id, name: a.name }));
  }

  function exitsOf(program: Program, roomId: string) {
    return program.rooms.get(roomId)?.definition.exits ?? [];
  }

  function projectionFor(args: {
    program: Program;
    m: MicroworldRecord;
    scene: Scene;
    ctx: TurnContext;
    present: { id: string; name: string }[];
  }): Projection {
    return project({
      scene: args.scene,
      ctx: args.ctx,
      programStamp: args.m.stamp,
      entry: args.program.entry === args.scene.room.id,
      exits: exitsOf(args.program, args.scene.room.id),
      present: args.present,
    });
  }

  function parseContextFor(
    scene: Scene,
    program: Program,
    present: { id: string; name: string }[],
    lastNoun: string | null,
  ): ParseContext {
    return {
      scene,
      exits: exitsOf(program, scene.room.id),
      people: present.map((p) => ({ id: p.id, handle: p.name })),
      lastNoun,
    };
  }

  /** Queue a notice to every other actor present in `room`. */
  async function notify(
    tx: StoreTx,
    microworldId: string,
    room: string,
    except: string,
    now: Date,
    text: string,
  ) {
    const since = new Date(now.getTime() - presenceMs);
    for (const a of await tx.actorsIn(room, since)) {
      if (a.id === except) continue;
      await tx.putActor({ ...a, pending: [...a.pending, text] });
    }
  }

  return {
    async load(microworldId, archive, now, opts = {}) {
      const limits = Limits.parse({ ...options.limits, ...opts.limits });
      const level = archive.manifest?.language ?? LANGUAGE_LEVEL;
      if (level > LANGUAGE_LEVEL) {
        throw new SproutError('language-too-new', `${microworldId} needs level ${level}`);
      }
      const sourceBytes = archive.files.reduce((n, f) => n + f.source.length, 0);
      if (archive.files.length > limits.files)
        throw new SproutError(
          'limit-exceeded',
          `${archive.files.length} files (${limits.files} at most)`,
        );
      if (sourceBytes > limits.sourceBytes)
        throw new SproutError(
          'limit-exceeded',
          `${sourceBytes} bytes of source (${limits.sourceBytes} at most)`,
        );
      for (const name of archive.manifest?.extensions ?? []) {
        if (!ext.has(name)) throw new SproutError('no-such-extension', name);
      }
      const { program, warnings, absent } = compileMicroworld(archive, {
        strict: false,
        ext,
        acceptedLevel: level,
      });
      if (program.rooms.size > limits.rooms)
        throw new SproutError(
          'limit-exceeded',
          `${program.rooms.size} rooms (${limits.rooms} at most)`,
        );
      if (program.objects.size > limits.objects)
        throw new SproutError(
          'limit-exceeded',
          `${program.objects.size} objects (${limits.objects} at most)`,
        );
      if (program.kinds.size > limits.kinds)
        throw new SproutError(
          'limit-exceeded',
          `${program.kinds.size} kinds (${limits.kinds} at most)`,
        );
      const stamp = archiveStamp(archive);
      programs.set(stamp, program);
      return store.transaction(microworldId, async (tx) => {
        const record: MicroworldRecord = {
          id: microworldId,
          archive: {
            files: archive.files.map((f) => ({ name: f.name, source: f.source })),
            manifest: archive.manifest ?? null,
          },
          stamp,
          level,
          extensions: [...program.uses],
          limits,
          loadedAt: now,
        };
        await tx.putMicroworld(record);
        // Re-normalise what is already here against the new definitions; drop what nothing answers for.
        const rows = await tx.objects();
        const world = microworldOf(program, rows, null, ext);
        const upsert: ObjectRecord[] = [];
        for (const row of rows) {
          const obj = world.objects.get(row.id);
          if (!obj) continue;
          upsert.push({ ...row, state: obj.state, container: obj.container, home: obj.home });
        }
        await tx.putObjects({ upsert, remove: world.orphans });
        return { microworldId, stamp, absent, warnings, dropped: world.orphans };
      });
    },

    async reset(microworldId) {
      await store.transaction(microworldId, async (tx) => {
        await loaded(tx, microworldId);
        await tx.clearObjects();
      });
    },

    async destroyMicroworld(microworldId) {
      await store.destroyMicroworld(microworldId);
    },

    async inspect(microworldId, as, now) {
      return store.read(microworldId, async (tx) => {
        const { m, program } = await loaded(tx, microworldId);
        const rows = await tx.objects();
        const world = microworldOf(program, rows, null, ext);
        const faults = (await tx.actions({ limit: 20, faultedOnly: true })).map((a) => ({
          at: a.at,
          roomId: a.roomId,
          command: a.command,
          message: a.fault?.message ?? '',
          ...(as === 'operator' ? { chain: a.fault?.chain ?? [] } : {}),
        }));
        const misses = await tx.misses({ limit: m.limits.misses });
        // Present means seen within the window — the same question "also here" asks.
        const since = new Date(now.getTime() - presenceMs);
        const present: ActorRecord[] = [];
        for (const room of program.rooms.keys()) present.push(...(await tx.actorsIn(room, since)));
        return {
          microworldId,
          stamp: m.stamp,
          files: m.archive.files.map((f) => f.name),
          limits: m.limits,
          absent: [...program.absent],
          orphans: world.orphans,
          faults,
          present: present.length,
          ...(as === 'operator'
            ? { presentActors: present.map((a) => ({ id: a.id, name: a.name })) }
            : {}),
          misses,
        };
      });
    },

    async snapshot(microworldId, objectId) {
      return store.read(microworldId, async (tx) => {
        const { program } = await loaded(tx, microworldId);
        const rows = await tx.objects();
        const world = microworldOf(program, rows, null, ext);
        const obj = world.objects.get(objectId);
        if (!obj) throw new SproutError('not-loaded', `${objectId} is not in ${microworldId}`);
        return { id: obj.id, state: { ...obj.state } };
      });
    },

    async forgetActor(actorId) {
      await store.forgetActor(actorId);
    },

    async exportActor(actorId) {
      return store.exportActor(actorId);
    },

    async trim(now) {
      const limits = Limits.parse(options.limits ?? {});
      await store.trim(new Date(now.getTime() - limits.actionDays * 86_400_000), limits.misses);
    },

    async complete(q) {
      return store.read(q.microworldId, async (tx) => {
        const { program } = await loaded(tx, q.microworldId);
        const me = await tx.actor(q.actor.id);
        if (!me?.roomId || !program.rooms.has(me.roomId)) return { completions: [] };
        const { world } = await worldOf(tx, program, q.actor.id);
        const scene = sceneFor(world, q.actor.id, me.roomId);
        const present = await presentIn(tx, me.roomId, q.actor.id, q.now);
        return {
          completions: completeCommand(
            parseContextFor(scene, program, present, me.lastNoun),
            q.prefix,
          ),
        };
      });
    },

    async forget(q) {
      await store.transaction(q.microworldId, async (tx) => {
        await loaded(tx, q.microworldId);
        await tx.clearMemory(q.actorId);
      });
    },

    async turn(req) {
      const started = Date.now();
      const name = nameOf(req.actor.name);
      if (req.input.kind === 'look') {
        // A READ turn (§4.5): no write lock, no action row, no room block.
        return store.read(req.microworldId, async (tx) => {
          const { m, program } = await loaded(tx, req.microworldId);
          const me = await tx.actor(req.actor.id);
          if (!me?.roomId || !program.rooms.has(me.roomId)) {
            return {
              lines: [{ kind: 'refused', text: 'You are not anywhere yet. Enter first.' }],
              scene: null,
              affordances: { actions: [], nouns: [] },
            };
          }
          const pending = me.pending.map((text): TranscriptLine => ({ kind: 'notice', text }));
          await tx.touchActor(req.actor.id, req.now, true);
          const { world } = await worldOf(tx, program, req.actor.id);
          const scene = sceneFor(world, req.actor.id, me.roomId);
          const present = await presentIn(tx, me.roomId, req.actor.id, req.now);
          const projection = projectionFor({
            program,
            m,
            scene,
            ctx: turnContext({ ext }),
            present,
          });
          return {
            lines: pending,
            scene: projection.view.stamp === req.knownStamp ? null : projection.view,
            affordances: projection.affordances,
          };
        });
      }
      const lockAsked = Date.now();
      return store.transaction(req.microworldId, async (tx) => {
        const lockWaitMs = Date.now() - lockAsked;
        const { m, program } = await loaded(tx, req.microworldId);
        const existing = await tx.actor(req.actor.id);
        const me: ActorRecord = existing
          ? { ...existing, name }
          : {
              microworldId: req.microworldId,
              id: req.actor.id,
              name,
              roomId: null,
              lastSeen: req.now,
              narration: [],
              lastNoun: null,
              pending: [],
            };
        const lines: TranscriptLine[] = me.pending.map((text) => ({ kind: 'notice', text }));
        me.pending = [];
        me.lastSeen = req.now;
        const empty = { actions: [], nouns: [] };

        if (req.input.kind === 'leave') {
          if (me.roomId)
            await notify(tx, req.microworldId, me.roomId, me.id, req.now, `${name} leaves.`);
          await tx.putActor({ ...me, roomId: null, lastSeen: new Date(0) });
          return { lines, scene: null, affordances: empty };
        }

        // Where they stand: the door, or back where they stood if that room still stands.
        let arrived = false;
        if (req.input.kind === 'enter') {
          if (!me.roomId || !program.rooms.has(me.roomId)) {
            if (!program.entry) {
              await tx.putActor(me);
              return {
                lines: [...lines, { kind: 'refused', text: 'No door here.' }],
                scene: null,
                affordances: empty,
              };
            }
            me.roomId = program.entry;
            me.narration = [];
            arrived = true;
          } else {
            lines.push(...me.narration.map((text): TranscriptLine => ({ kind: 'said', text })));
          }
        } else if (!me.roomId || !program.rooms.has(me.roomId)) {
          await tx.putActor(me);
          return {
            lines: [...lines, { kind: 'refused', text: 'You are not anywhere yet. Enter first.' }],
            scene: null,
            affordances: empty,
          };
        }
        const roomId = me.roomId!;
        const ctx = turnContext({
          ext,
          budget: new SproutBudget(),
          liveCount: 0,
          mint: () => `pending`,
        });
        const { world, memory } = await worldOf(tx, program, req.actor.id);
        ctx.liveCount = world.objects.size;
        const present = await presentIn(tx, roomId, req.actor.id, req.now);
        // Spawn ids come from the store, inside this invocation (§4.5-2):
        // the engine's mint is synchronous, so a turn that could spawn
        // reserves a batch of numbers first — the cap's worth — and the
        // gaps a turn leaves in the counter are harmless.
        const minted: string[] = [];
        ctx.mint = () => {
          const id = minted.shift();
          if (!id) throw new Error('a spawn id was not reserved');
          return id;
        };
        const reserve = async () => {
          if (program.kinds.size === 0) return;
          for (let i = 0; i < SPROUT_SPAWNS_PER_ACTION; i++)
            minted.push(`spawn-${await tx.nextSpawn()}`);
        };

        let scene = sceneFor(world, req.actor.id, roomId);
        let projection = projectionFor({ program, m, scene, ctx, present });
        let command: Command | null = null;
        let commandText = '';
        let missed = false;
        let question: string | null = null;

        if (req.input.kind === 'say') {
          commandText = req.input.text;
          const parsed = parseCommand(
            parseContextFor(scene, program, present, me.lastNoun),
            req.input.text,
          );
          if (parsed.ok) {
            command = parsed.command;
            if (parsed.noun) me.lastNoun = parsed.noun;
          } else {
            question = parsed.reply;
            missed = parsed.missed;
          }
        } else if (req.input.kind === 'chip') {
          const action = resolveToken(req.input.token, projection);
          if (!action) {
            lines.push({ kind: 'refused', text: 'That is not something you can do here now.' });
          } else {
            command = commandOf(action, req.input.args ?? []);
            commandText = describeAction(action, scene);
          }
        }

        let outcome: Outcome | null = null;
        let moved: { room: string } | null = null;
        const spoke: TranscriptLine[] = [];
        if (command) {
          await reserve();
          const result = await perform(command, {
            scene,
            world,
            program,
            ctx,
            actorId: req.actor.id,
            roomId,
            present,
            reload: (elsewhere) => {
              scene = sceneFor(world, req.actor.id, roomId, elsewhere);
              return scene;
            },
          });
          outcome = result.outcome;
          spoke.push(...result.lines);
          moved = result.moved;
        }

        if (question !== null) {
          lines.push({ kind: missed ? 'miss' : 'question', text: question });
          if (missed) {
            // A miss is an action with `missed` (§4.2) — the zone's miss rate is a
            // number the builder can see; the TEXT is kept only when they chose to.
            await tx.appendAction({
              microworldId: req.microworldId,
              at: req.now,
              roomId,
              command: commandText,
              events: 0,
              depth: 0,
              spawned: 0,
              faulted: false,
              fault: null,
              missed: true,
              durationMs: Math.max(0, Date.now() - started),
              lockWaitMs: Math.max(0, lockWaitMs),
            });
            if (req.options?.keepMissText) {
              await tx.appendMiss(
                missSnapshot(parseContextFor(scene, program, present, me.lastNoun), roomId, req),
              );
            }
          }
        }

        if (outcome?.fault) {
          // A fault writes nothing OF THE WORLD (§4.5-3): the evaluator moved
          // objects in memory only, and those rows are never written. What
          // lands is the action record — and, as on a read turn, the actor's
          // own row: the heartbeat, their pending lines drained (they read
          // them just now), their narration cleared.
          lines.push({
            kind: 'fault',
            text: 'Something here tangles itself up, and nothing happens.',
          });
          await tx.appendAction(
            actionRecord(req, roomId, commandText, outcome, started, lockWaitMs, false),
          );
          me.narration = [];
          await tx.putActor(me);
          const fresh = await worldOf(tx, program, req.actor.id);
          const clean = sceneFor(fresh.world, req.actor.id, roomId);
          const p = projectionFor({ program, m, scene: clean, ctx: turnContext({ ext }), present });
          return { lines, scene: p.view, affordances: p.affordances };
        }

        if (outcome) {
          const change = rowsAfter(
            req.microworldId,
            scene,
            outcome,
            new Set([req.actor.id, ...present.map((p) => p.id)]),
          );
          await tx.putObjects(change);
          if (outcome.remembered.size > 0) await tx.putMemory(memoryAfter(memory, scene, outcome));
          if (
            command &&
            command.kind !== 'look' &&
            command.kind !== 'examine' &&
            command.kind !== 'inventory' &&
            command.kind !== 'help' &&
            command.kind !== 'wait'
          ) {
            await tx.appendAction(
              actionRecord(req, roomId, commandText, outcome, started, lockWaitMs, missed),
            );
          }
        }
        lines.push(...spoke);
        me.narration = spoke.filter((l) => l.kind === 'said').map((l) => l.text);

        if (moved) {
          await notify(tx, req.microworldId, roomId, me.id, req.now, `${name} leaves.`);
          await notify(tx, req.microworldId, moved.room, me.id, req.now, `${name} arrives.`);
          me.roomId = moved.room;
          me.narration = [];
          arrived = true;
        } else if (arrived) {
          await notify(tx, req.microworldId, roomId, me.id, req.now, `${name} arrives.`);
        }
        await tx.putActor(me);

        // The answer: the scene as it now stands.
        const after = await worldOf(tx, program, req.actor.id);
        const here = me.roomId!;
        const finalScene = sceneFor(after.world, req.actor.id, here);
        const finalPresent = await presentIn(tx, here, req.actor.id, req.now);
        projection = projectionFor({
          program,
          m,
          scene: finalScene,
          ctx: turnContext({ ext, budget: ctx.budget }),
          present: finalPresent,
        });
        if (arrived) lines.push(...roomLines(projection.view));
        return {
          lines,
          scene: projection.view.stamp === req.knownStamp && !arrived ? null : projection.view,
          affordances: projection.affordances,
        };
      });
    },
  };

  // --- helpers that need the closure -------------------------------------------

  function commandOf(action: Action, args: string[]): Command {
    switch (action.kind) {
      case 'verb':
        return {
          kind: 'verb',
          targetId: action.targetId,
          message: action.message,
          args: Object.fromEntries(args.map((a, i) => [String(i), a])),
        };
      case 'take':
        return { kind: 'take', itemIds: [action.id] };
      case 'drop':
        return { kind: 'drop', itemIds: [action.id] };
      case 'examine':
        return { kind: 'examine', id: action.id };
      case 'go':
        return { kind: 'go', toRoomId: action.to };
      case 'give':
        return { kind: 'give', itemId: action.id, toProfileId: action.to };
    }
  }

  function describeAction(action: Action, scene: Scene): string {
    const nameOfId = (id: string) =>
      [scene.room, ...scene.items].find((o) => o.id === id)?.definition.name ?? id;
    switch (action.kind) {
      case 'verb':
        return `${action.message} — ${nameOfId(action.targetId)}`;
      case 'take':
        return `take — ${nameOfId(action.id)}`;
      case 'drop':
        return `drop — ${nameOfId(action.id)}`;
      case 'examine':
        return `examine — ${nameOfId(action.id)}`;
      case 'go':
        return `go — ${action.to}`;
      case 'give':
        return `give — ${nameOfId(action.id)} to ${action.to}`;
    }
  }

  interface PerformArgs {
    scene: Scene;
    world: Microworld;
    program: Program;
    ctx: TurnContext;
    actorId: string;
    roomId: string;
    present: { id: string; name: string }[];
    reload: (elsewhere: { room?: string; actors?: string[] }) => Scene;
  }

  /** Run one command through the engine; the lines it produces, the outcome to apply, and where the actor moved. */
  async function perform(
    command: Command,
    a: PerformArgs,
  ): Promise<{ lines: TranscriptLine[]; outcome: Outcome | null; moved: { room: string } | null }> {
    const said = (out: Outcome): TranscriptLine[] => [
      ...out.narration.map((text): TranscriptLine => ({ kind: 'said', text })),
      ...effectLines(out.effects),
    ];
    switch (command.kind) {
      case 'verb': {
        const target = [a.scene.room, ...a.scene.items].find((o) => o.id === command.targetId);
        if (!target)
          return {
            lines: [{ kind: 'refused', text: "You can't see any such thing." }],
            outcome: null,
            moved: null,
          };
        const outcome = runVerb(a.scene, a.ctx, command.targetId, command.message, command.args);
        if (!outcome.ok)
          return {
            lines: [{ kind: 'refused', text: "You can't do that here now." }],
            outcome: null,
            moved: null,
          };
        return { lines: said(outcome), outcome, moved: null };
      }
      case 'take':
      case 'drop': {
        const lines: TranscriptLine[] = [];
        let last: Outcome | null = null;
        for (const id of command.itemIds) {
          const to = command.kind === 'take' ? a.actorId : a.roomId;
          const outcome = runMove(a.scene, a.ctx, id, to);
          if (!outcome.ok) {
            lines.push({ kind: 'refused', text: "You can't see any such thing." });
            continue;
          }
          if (outcome.refused) lines.push({ kind: 'refused', text: outcome.refused });
          lines.push(
            ...said({
              ...outcome,
              narration: outcome.refused
                ? outcome.narration.filter((n) => n !== outcome.refused)
                : outcome.narration,
            }),
          );
          last = mergeOutcomes(last, outcome);
          if (outcome.fault) break;
        }
        return { lines, outcome: last, moved: null };
      }
      case 'put': {
        const outcome = runMove(a.scene, a.ctx, command.itemId, command.intoId);
        if (!outcome.ok)
          return {
            lines: [{ kind: 'refused', text: "You can't see any such thing." }],
            outcome: null,
            moved: null,
          };
        return {
          lines: [
            ...(outcome.refused
              ? [{ kind: 'refused', text: outcome.refused } as TranscriptLine]
              : []),
            ...said({
              ...outcome,
              narration: outcome.narration.filter((n) => n !== outcome.refused),
            }),
          ],
          outcome,
          moved: null,
        };
      }
      case 'give': {
        if (!a.present.some((p) => p.id === command.toProfileId)) {
          return {
            lines: [{ kind: 'refused', text: 'They are not here.' }],
            outcome: null,
            moved: null,
          };
        }
        const scene = a.reload({ actors: [command.toProfileId] });
        const outcome = runMove(scene, a.ctx, command.itemId, command.toProfileId);
        if (!outcome.ok)
          return {
            lines: [{ kind: 'refused', text: "You can't see any such thing." }],
            outcome: null,
            moved: null,
          };
        return {
          lines: [
            ...(outcome.refused
              ? [{ kind: 'refused', text: outcome.refused } as TranscriptLine]
              : []),
            ...said({
              ...outcome,
              narration: outcome.narration.filter((n) => n !== outcome.refused),
            }),
          ],
          outcome,
          moved: null,
        };
      }
      case 'go': {
        const exits = a.program.rooms.get(a.roomId)?.definition.exits ?? [];
        if (
          !exits.some((e) => e.toRoomId === command.toRoomId) ||
          !a.program.rooms.has(command.toRoomId)
        ) {
          return {
            lines: [{ kind: 'refused', text: "You can't go that way." }],
            outcome: null,
            moved: null,
          };
        }
        const scene = a.reload({ room: command.toRoomId });
        const outcome = runMove(scene, a.ctx, a.actorId, command.toRoomId);
        if (!outcome.ok)
          return {
            lines: [{ kind: 'refused', text: "You can't go that way." }],
            outcome: null,
            moved: null,
          };
        if (outcome.refused)
          return { lines: [{ kind: 'refused', text: outcome.refused }], outcome, moved: null };
        return {
          lines: said(outcome),
          outcome,
          moved: outcome.fault ? null : { room: command.toRoomId },
        };
      }
      case 'look': {
        const p = project({
          scene: a.scene,
          ctx: a.ctx,
          programStamp: '',
          entry: a.program.entry === a.roomId,
          exits: a.program.rooms.get(a.roomId)?.definition.exits ?? [],
          present: a.present,
        });
        return { lines: roomLines(p.view), outcome: null, moved: null };
      }
      case 'examine': {
        const obj = [...a.scene.items].find((o) => o.id === command.id);
        if (!obj)
          return {
            lines: [{ kind: 'refused', text: "You can't see any such thing." }],
            outcome: null,
            moved: null,
          };
        const d = describeWith(obj, a.scene, a.ctx);
        return {
          lines: [{ kind: 'said', text: d.prose }, ...effectLines(d.effects)],
          outcome: null,
          moved: null,
        };
      }
      case 'inventory': {
        const held = a.scene.items.filter((i) => i.container === a.actorId);
        return {
          lines: [
            {
              kind: 'said',
              text:
                held.length === 0
                  ? 'You are carrying nothing.'
                  : `You are carrying ${held.map((o) => o.definition.name.toLowerCase()).join(', ')}.`,
            },
          ],
          outcome: null,
          moved: null,
        };
      }
      case 'wait':
        return { lines: [{ kind: 'said', text: 'Time passes.' }], outcome: null, moved: null };
      case 'help': {
        const could = whatYouCanSay(parseContextFor(a.scene, a.program, a.present, null));
        return {
          lines: [
            {
              kind: 'said',
              text:
                could.length > 0
                  ? `Here you might: ${could.join('; ')}. And always: look, examine, take, drop, put … in, give … to, go, inventory.`
                  : 'Nothing here answers to a verb of its own. Always: look, examine, take, drop, go, inventory.',
            },
          ],
          outcome: null,
          moved: null,
        };
      }
    }
  }

  function missSnapshot(ctx: ParseContext, roomId: string, req: TurnRequest): MissRecord {
    const input = req.input.kind === 'say' ? req.input.text : '';
    return {
      microworldId: req.microworldId,
      at: req.now,
      roomId,
      input,
      couldSay: whatYouCanSay(ctx),
      couldName: [...new Set(dictionary(ctx).flatMap((e) => e.phrases.map((p) => p.join(' '))))],
      state: {
        room: ctx.scene.room.state,
        items: Object.fromEntries(ctx.scene.items.map((i) => [i.definition.name, i.state])),
      },
    };
  }
}

function mergeOutcomes(a: Outcome | null, b: Outcome): Outcome {
  if (!a) return b;
  return {
    ok: a.ok && b.ok,
    narration: [...a.narration, ...b.narration],
    changed: new Set([...a.changed, ...b.changed]),
    remembered: new Set([...a.remembered, ...b.remembered]),
    moved: new Map([...a.moved, ...b.moved]),
    effects: [...a.effects, ...b.effects],
    spawned: [...a.spawned, ...b.spawned],
    destroyed: new Set([...a.destroyed, ...b.destroyed]),
    events: a.events + b.events,
    maxDepth: Math.max(a.maxDepth, b.maxDepth),
    fault: b.fault ?? a.fault,
  };
}

function actionRecord(
  req: TurnRequest,
  roomId: string,
  command: string,
  outcome: Outcome,
  started: number,
  lockWaitMs: number,
  missed: boolean,
): ActionRecord {
  return {
    microworldId: req.microworldId,
    at: req.now,
    roomId,
    command,
    events: outcome.events,
    depth: outcome.maxDepth,
    spawned: outcome.spawned.length,
    faulted: outcome.fault !== null,
    fault: outcome.fault
      ? {
          message: outcome.fault.message,
          chain: outcome.fault.chain.map((e) => ({
            id: e.id,
            name: e.name,
            from: e.from,
            depth: e.depth,
          })),
        }
      : null,
    missed,
    durationMs: Math.max(0, Date.now() - started),
    lockWaitMs: Math.max(0, lockWaitMs),
  };
}
