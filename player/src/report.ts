import {
  initialState,
  isPlace,
  locationOf,
  nodesOf,
  readerOf,
  type Bundle,
  type InstanceId,
  type KindRef,
  type ProseLiteral,
  type WrittenAt,
} from '@overstory/sprout/lang';

import type { PlayedStep, Traced } from './play.js';
import { catalogueFor, pathOf } from './stand.js';

// What a playthrough reached, and the prose nobody saw (`sprout play
// --report`, `sprout test --report`): metrics computed from the engine and
// the transcript, with no model involved. Over several scripts it is their
// union, what a round of playtests reached between them. Places, objects,
// handlers and passages count what the world's own files declare, as its
// manifest lists them; verbs count every verb a visitor may type, the
// engine's and the standard library's among them.
//
// A passage is reached when someone read what it rendered: one whose
// every branch printed nothing for its reader was not seen, and counts as
// never. A one-line passage, a string given to `say`, `tell`, `text` or
// `refuse`, is known by where it stands. A turn that faulted is reported
// in full and reaches only the words it told of the fault, since what it
// did was undone.

/** One script played, by the name its steps are reported under. */
export interface PlayedRun {
  readonly name: string;
  readonly played: readonly PlayedStep[];
}

/** Of one kind of thing a world declares: how many, which were reached, and which never were. */
export interface Reach {
  readonly declared: number;
  readonly reached: readonly string[];
  readonly never: readonly string[];
}

/** A line a visitor typed that the world did not act on as typed, and what they read instead. */
export interface Misread {
  readonly at: string;
  readonly as: string;
  readonly typed: string;
  /** The engine line the parser answered with, by name; null for a refusal in the consent pass. */
  readonly line: string | null;
  readonly said: string;
}

/** A fault, in full, and the step whose turn it ended. */
export interface ReportedFault {
  readonly at: string;
  readonly turn: Traced['turn'];
  readonly name: string;
  readonly detail: string;
  readonly against: string | null;
}

/** The same line typed, or the same answer read, three or more times in a row by one visitor. */
export interface Repeated {
  readonly at: string;
  readonly as: string;
  readonly what: 'line' | 'answer';
  readonly text: string;
  readonly times: number;
}

export interface Report {
  readonly scripts: readonly string[];
  /** Every seed a step set, and 0, which a script starts at. */
  readonly seeds: readonly number[];
  /** Command turns each visitor typed, by nickname. */
  readonly turns: Readonly<Record<string, number>>;
  readonly reading: {
    /** Lines typed. */
    readonly typed: number;
    /** Lines the parser answered in place of reading them: `unknown`, `not_here` and the rest. */
    readonly unread: readonly Misread[];
    /** Lines read, and refused in the consent pass. */
    readonly refused: readonly Misread[];
    /** Unread lines as a share of those typed, to two places; 0 where none were typed. */
    readonly unreadRate: number;
    /** Refused lines as a share of those typed, likewise. */
    readonly refusedRate: number;
  };
  readonly faults: readonly ReportedFault[];
  readonly reach: {
    readonly places: Reach;
    readonly objects: Reach;
    readonly verbs: Reach;
    readonly handlers: Reach;
    readonly passages: Reach;
  };
  readonly repetition: readonly Repeated[];
}

/** The world's declarations, as reach counts them: each by its key, with what a report shows for it. */
interface Declared {
  readonly places: ReadonlyMap<string, string>;
  readonly objects: ReadonlyMap<string, string>;
  readonly verbs: ReadonlyMap<string, string>;
  readonly handlers: ReadonlyMap<string, string>;
  readonly passages: ReadonlyMap<string, string>;
}

/** A passage's key, as `writtenKey` makes it: `study.Lamp.dark`, or `lamp.sprout:6:11`. */
function keyOf(written: WrittenAt): string {
  return 'passage' in written ? `${written.origin}.${written.passage}` : written.line;
}

/** A string's first words, for a one-line passage shown in a list. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

/** What `bundle`'s own files declare, which reach is counted against. */
function declaredIn(bundle: Bundle): Declared {
  const own = new Set(bundle.manifest.files);
  const ownAt = (at: { readonly source: { readonly name: string } }) => own.has(at.source.name);
  const catalogue = catalogueFor(bundle);
  const reader = readerOf(initialState(catalogue));
  const { world } = catalogue;

  const places = new Map<string, string>();
  const objects = new Map<string, string>();
  const entries = [...catalogue.declared.values()].sort((a, b) => a.rank - b.rank);
  for (const { id } of entries) {
    if (id === world) continue;
    (isPlace(reader, id) ? places : objects).set(id, pathOf(world, id));
  }

  const verbs = new Map<string, string>();
  for (const { verb } of catalogue.phrases) {
    const key = `${verb.library}.${verb.name}`;
    verbs.set(key, key);
  }

  const kinds: KindRef[] = [...bundle.kinds];
  for (const entry of entries) if (entry.kind !== null) kinds.push(entry.kind);
  const handlers = new Map<string, string>();
  const passages = new Map<string, string>();
  for (const kind of kinds) {
    for (const [on, runs] of kind.handlers) {
      for (const { origin, declaration } of runs) {
        if (!ownAt(declaration.at)) continue;
        const at = locationOf(declaration.at);
        handlers.set(at, `${origin} on ${on} (${at})`);
      }
    }
    for (const [property, runs] of kind.hooks) {
      for (const { origin, declaration } of runs) {
        if (!ownAt(declaration.at)) continue;
        const at = locationOf(declaration.at);
        handlers.set(at, `${origin} on changed :${property} (${at})`);
      }
    }
    for (const passage of kind.passages.values()) {
      if (!ownAt(passage.at)) continue;
      const key = `${passage.origin}.${passage.name}`;
      passages.set(key, `${key} (${locationOf(passage.at)})`);
    }
  }
  for (const node of nodesOf(bundle.definitions)) {
    if (node.kind !== 'prose-literal') continue;
    const { prose, value } = node as ProseLiteral;
    if (!ownAt(prose.at)) continue;
    const at = locationOf(prose.at);
    passages.set(at, `${at} "${excerpt(value)}"`);
  }
  return { places, objects, verbs, handlers, passages };
}

/** `reached` of `declared`, each shown as the report shows it, in declared order. */
function reachOf(declared: ReadonlyMap<string, string>, reached: ReadonlySet<string>): Reach {
  const shown = [...declared];
  return {
    declared: declared.size,
    reached: shown.filter(([key]) => reached.has(key)).map(([, one]) => one),
    never: shown.filter(([key]) => !reached.has(key)).map(([, one]) => one),
  };
}

/** Everything each reading filled a role with, one id apiece. */
function filled(turn: Traced): InstanceId[] {
  if (turn.reading === null) return [];
  return [...turn.reading.bindings.values()].flatMap((bound) =>
    'object' in bound ? [bound.object] : 'set' in bound ? [...bound.set] : [],
  );
}

/** Runs of three or more alike in a row, by one visitor. */
function repeats(
  seen: readonly { at: string; as: string; text: string }[],
  what: Repeated['what'],
): Repeated[] {
  const out: Repeated[] = [];
  const byVisitor = new Map<string, { at: string; text: string }[]>();
  for (const { at, as, text } of seen) {
    const list = byVisitor.get(as) ?? [];
    list.push({ at, text });
    byVisitor.set(as, list);
  }
  for (const [as, list] of byVisitor) {
    let from = 0;
    for (let i = 1; i <= list.length; i++) {
      if (i < list.length && list[i]!.text === list[from]!.text) continue;
      const times = i - from;
      if (times >= 3) out.push({ at: list[from]!.at, as, what, text: list[from]!.text, times });
      from = i;
    }
  }
  return out;
}

/** What `runs`, each played over a freshly loaded `bundle`, reached between them. */
export function reportOf(bundle: Bundle, runs: readonly PlayedRun[]): Report {
  const declared = declaredIn(bundle);
  const { world } = catalogueFor(bundle);
  const seeds = new Set<number>([0]);
  const turns: Record<string, number> = {};
  const unread: Misread[] = [];
  const refused: Misread[] = [];
  const faults: ReportedFault[] = [];
  const lines: { at: string; as: string; text: string }[] = [];
  const answers: { at: string; as: string; text: string }[] = [];
  const reached = {
    places: new Set<string>(),
    objects: new Set<string>(),
    verbs: new Set<string>(),
    handlers: new Set<string>(),
    passages: new Set<string>(),
  };
  let typed = 0;

  for (const { name, played } of runs) {
    played.forEach(({ step, turns: ran }, i) => {
      const at = `${name}, step ${i + 1}`;
      if ('seed' in step) seeds.add(step.seed);
      for (const turn of ran) {
        for (const place of turn.standing) reached.places.add(place);
        for (const id of filled(turn)) reached.objects.add(id);
        if (turn.reading !== null) {
          reached.verbs.add(`${turn.reading.verb.library}.${turn.reading.verb.name}`);
        }
        for (const one of turn.ran) reached.handlers.add(one.at);
        for (const effect of turn.effects) {
          for (const written of effect.written) reached.passages.add(keyOf(written));
        }
        for (const { name: fault, detail, object } of turn.faults) {
          const against = object === null ? null : pathOf(world, object);
          faults.push({ at, turn: turn.turn, name: fault, detail, against });
        }
        if (turn.turn === 'command' && turn.as !== null) {
          turns[turn.as] = (turns[turn.as] ?? 0) + 1;
        }
      }
      if (!('as' in step)) return;
      typed += 1;
      lines.push({ at, as: step.as, text: step.type.trim() });
      const commands = ran.filter((turn) => turn.turn === 'command');
      answers.push({ at, as: step.as, text: commands.map(toActor).join(' ') });
      const first = commands[0];
      if (first === undefined) return;
      const said = toActor(first);
      const misread = { at, as: step.as, typed: step.type, said };
      if (first.answered !== null && first.answered !== 'nothing_happens') {
        unread.push({ ...misread, line: first.answered });
      } else if (first.refused) refused.push({ ...misread, line: null });
    });
  }

  return {
    scripts: runs.map((run) => run.name),
    seeds: [...seeds].sort((a, b) => a - b),
    turns,
    reading: {
      typed,
      unread,
      refused,
      unreadRate: share(unread.length, typed),
      refusedRate: share(refused.length, typed),
    },
    faults,
    reach: {
      places: reachOf(declared.places, reached.places),
      objects: reachOf(declared.objects, reached.objects),
      verbs: reachOf(declared.verbs, reached.verbs),
      handlers: reachOf(declared.handlers, reached.handlers),
      passages: reachOf(declared.passages, reached.passages),
    },
    repetition: [...repeats(lines, 'line'), ...repeats(answers, 'answer')],
  };
}

/** `part` of `whole`, to two places; 0 of nothing. */
function share(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100) / 100;
}

/** What a command turn said to the one who typed it. */
function toActor(turn: Traced): string {
  return turn.effects
    .filter((effect) => effect.actor !== null && effect.to === effect.actor)
    .flatMap((effect) => effect.paragraphs)
    .join(' ');
}

/** `report` as its file holds it. */
export function writeReport(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
