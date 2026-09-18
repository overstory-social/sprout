import {
  describeWith,
  memoryOf,
  openVerbs,
  takeableOf,
  visibleItems,
  type Effect,
  type Scene,
  type SproutMemory,
  type SproutObject,
  type TurnContext,
} from '@overstory/sprout';

import { stampOf } from './scene.js';

// The turn's wire (the split proposal §4.2): one input, one response.
// Chips are TOKENS core minted for the scene it describes and resolves
// against the scene it loads next — nothing of the parser crosses the
// wire, and a stale or forged token is a `refused` line. One channel per
// fact: effects live in `lines` and nowhere else.

export type TurnInput =
  /** The door, or back where they stood if that room still stands. */
  | { kind: 'enter' }
  /** The poll, and the presence heartbeat — a READ turn. */
  | { kind: 'look' }
  /** A typed line — the universal input. */
  | { kind: 'say'; text: string }
  /** A chip: a token core minted for THIS scene. */
  | { kind: 'chip'; token: string; args?: string[] }
  /** Gone: presence ends now, not when the window expires. */
  | { kind: 'leave' };

export interface TurnRequest {
  microworldId: string;
  /** The name is a stable, host-unique token (§4.3): Overstory's handle, the CLI's login. */
  actor: { id: string; name: string };
  input: TurnInput;
  now: Date;
  /** The scene stamp the client already has; a matching stamp answers with `scene: null`. */
  knownStamp?: string;
  options?: { keepMissText?: boolean };
}

export interface TranscriptLine {
  kind: 'said' | 'room' | 'question' | 'miss' | 'refused' | 'fault' | 'notice' | 'effect';
  text: string;
  effect?: Effect;
}

export interface ItemView {
  id: string;
  name: string;
  prose: string;
  verbs: string[];
  portable: boolean;
  carried: boolean;
  /** The container it sits in, when not directly here. */
  inside: string | null;
}

export interface SceneView {
  stamp: string;
  room: { id: string; name: string; prose: string; entry: boolean };
  exits: { label: string; to: string }[];
  items: ItemView[];
  carrying: ItemView[];
  memory: SproutMemory[];
  present: { id: string; name: string }[];
}

export interface Affordance {
  label: string;
  token: string;
}

export interface Affordances {
  actions: Affordance[];
  nouns: Affordance[];
}

export interface TurnResponse {
  /** In order: pending lines from others, then what happened. */
  lines: TranscriptLine[];
  /** Null when `knownStamp` matched — nothing changed. */
  scene: SceneView | null;
  affordances: Affordances;
}

/** What a chip does, before it is a token. */
export type Action =
  | { kind: 'verb'; targetId: string; message: string }
  | { kind: 'take'; id: string }
  | { kind: 'drop'; id: string }
  | { kind: 'examine'; id: string }
  | { kind: 'go'; to: string }
  | { kind: 'give'; id: string; to: string };

export interface Projection {
  view: SceneView;
  affordances: Affordances;
  /** The actions behind the tokens, in token order. */
  actions: Action[];
}

const itemView =
  (scene: Scene, ctx: TurnContext, root: SproutObject) =>
  (i: SproutObject): ItemView => ({
    id: i.id,
    name: i.definition.name,
    prose: describeWith(i, scene, ctx).prose,
    verbs: openVerbs(i, scene, ctx),
    portable: takeableOf(i),
    carried: root.kind === 'actor',
    inside: i.container === root.id ? null : i.container,
  });

/**
 * The scene as a visitor reads it, and the chips it offers. The stamp
 * covers what a client would redraw for: the room, every object's state
 * and place, who is present, and the program's own stamp.
 */
export function project(args: {
  scene: Scene;
  ctx: TurnContext;
  programStamp: string;
  entry: boolean;
  exits: readonly { label: string; toRoomId: string }[];
  present: readonly { id: string; name: string }[];
}): Projection {
  const { scene, ctx } = args;
  const here = visibleItems(scene, scene.room);
  const held = visibleItems(scene, scene.actor);
  const room = describeWith(scene.room, scene, ctx);
  const stamp = stampOf(
    JSON.stringify([
      args.programStamp,
      scene.room.id,
      scene.room.state,
      scene.room.visitor,
      [...here, ...held].map((i) => [i.id, i.container, i.state, i.visitor]),
      args.present.map((p) => [p.id, p.name]),
    ]),
  );
  const actions: Action[] = [];
  const chips: Affordance[] = [];
  const offer = (label: string, action: Action) => {
    actions.push(action);
    chips.push({ label, token: `${stamp}.${actions.length - 1}` });
  };
  for (const verb of openVerbs(scene.room, scene, ctx)) {
    offer(verb, { kind: 'verb', targetId: scene.room.id, message: verb });
  }
  for (const i of here) {
    for (const verb of openVerbs(i, scene, ctx)) {
      offer(`${verb} — ${i.definition.name}`, { kind: 'verb', targetId: i.id, message: verb });
    }
    if (takeableOf(i)) offer(`take — ${i.definition.name}`, { kind: 'take', id: i.id });
  }
  for (const i of held) {
    for (const verb of openVerbs(i, scene, ctx)) {
      offer(`${verb} — ${i.definition.name}`, { kind: 'verb', targetId: i.id, message: verb });
    }
    offer(`drop — ${i.definition.name}`, { kind: 'drop', id: i.id });
    for (const p of args.present) {
      offer(`give — ${i.definition.name} to ${p.name}`, { kind: 'give', id: i.id, to: p.id });
    }
  }
  for (const e of args.exits) offer(e.label, { kind: 'go', to: e.toRoomId });
  const nouns: Affordance[] = [];
  for (const i of [...here, ...held]) {
    actions.push({ kind: 'examine', id: i.id });
    nouns.push({ label: i.definition.name, token: `${stamp}.${actions.length - 1}` });
  }
  return {
    view: {
      stamp,
      room: {
        id: scene.room.id,
        name: scene.room.definition.name,
        prose: room.prose,
        entry: args.entry,
      },
      exits: args.exits.map((e) => ({ label: e.label, to: e.toRoomId })),
      items: here.map(itemView(scene, ctx, scene.room)),
      carrying: held.map(itemView(scene, ctx, scene.actor)),
      memory: memoryOf(scene),
      present: [...args.present],
    },
    affordances: { actions: chips, nouns },
    actions,
  };
}

/** A token back to its action — for the scene whose stamp it carries, else null. */
export function resolveToken(token: string, projection: Projection): Action | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  if (token.slice(0, dot) !== projection.view.stamp) return null;
  const n = Number(token.slice(dot + 1));
  return Number.isInteger(n) ? (projection.actions[n] ?? null) : null;
}

/** The lines an effect list becomes. */
export function effectLines(effects: readonly Effect[]): TranscriptLine[] {
  return effects.map((effect) => ({ kind: 'effect', text: '', effect }));
}

/** The room block a visitor reads on arrival: name, prose, what is here, the ways on. */
export function roomLines(view: SceneView): TranscriptLine[] {
  const parts = [view.room.name, view.room.prose];
  if (view.items.length > 0) {
    parts.push(`You can see ${view.items.map((i) => i.name.toLowerCase()).join(', ')} here.`);
  }
  if (view.present.length > 0)
    parts.push(`Also here: ${view.present.map((p) => p.name).join(', ')}.`);
  return [{ kind: 'room', text: parts.filter((p) => p !== '').join('\n\n') }];
}
