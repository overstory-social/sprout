// Every passage, checked against each place it is said from (the spec's
// Prose › Passages: a passage may use the bindings of the body that
// invokes it, and may then only be invoked from a body where those
// bindings exist; The compiler › Two tiers, What it refuses).
//
// A passage's `self` is the kind that wrote it, and the rest of its scope
// is the invoking body's. The places a passage is said from are exact: a
// `say` or `refuse` naming it, in a body a kind runs, reaches the passage
// that kind has of that name, so a composer's own line is checked against
// every body of its closure that says it; a slot `{pot.greeting}` reaches
// the passage of that name on every kind composing `pot`'s, run with only
// `actor` and `here` beside its own `self`; and a passage named for one
// of the engine's lines is the engine's to say, on whatever kind it
// reaches, with what the engine binds for that line. A passage said from
// nowhere is checked with `self` alone. A name a passage renders that is
// bound nowhere it is said from is refused where it is said, and nothing
// more is said of that passage from there.

import type { Expr } from '../syntax/ast.js';
import type { Prose, ProseIf, ProsePiece } from '../syntax/ast-prose.js';
import { isLoopVariable } from '../syntax/ast-prose.js';
import { GUARD_NAMES } from '../syntax/ast.js';
import { Diagnostics, type Diagnostic } from '../source/diagnostics.js';
import type { Node } from '../source/nodes.js';
import type { Span } from '../source/source.js';
import { readable } from '../source/words.js';
import {
  PLACE_LINES,
  WORLD_LINES,
  type EngineBinds,
  type EnginePassage,
} from '../declare/engine-passages.js';
import { composesKind, kindName, type KindLookup, type KindRef } from '../declare/kinds.js';
import type { ResolvedPassage } from '../declare/passages.js';
import {
  OPEN_OBJECT,
  Scope,
  selfBinding,
  setOf,
  showBindingType,
  type Binding,
} from './bindings.js';
import type { CheckContext } from './check.js';
import type { NameScope } from './names.js';
import { nameFrom } from '../declare/names.js';
import { checkProse } from './prose.js';
import type { PassageRendered, PassageSites } from './speech.js';

/** A composed kind whose passages are checked, and where names in them resolve from. */
export interface Speaker {
  readonly kind: KindRef;
  readonly names?: NameScope;
}

/** What the passages are checked against. */
export interface PassageSetting {
  /** Every composed kind: each named kind, an object's own, the world's. */
  readonly speakers: readonly Speaker[];
  readonly kinds: KindLookup;
  readonly diagnostics: Diagnostics;
  /** What the bundle's bodies said, recorded as they were checked. */
  readonly sites: PassageSites;
}

/** Where a passage is said from, as a refusal of a name it lacks says it. */
type From =
  | { readonly from: 'said'; readonly at: Span }
  | { readonly from: 'rendered'; readonly at: Span }
  | { readonly from: 'engine'; readonly line: EnginePassage }
  | { readonly from: 'nowhere' };

interface Saying {
  readonly passage: ResolvedPassage;
  /** The invoking scope, `self` left out: the passage's own is its writer's. */
  readonly scope: Scope;
  readonly from: From;
}

/** Check every passage the setting's kinds have against every place it is said from. */
export function checkPassages(setting: PassageSetting): void {
  const run = runOver(setting);
  for (const speaker of setting.speakers) {
    const { kind } = speaker;
    for (const body of bodiesOf(kind)) {
      for (const site of setting.sites.of(body)) {
        const passage = kind.passages.get(site.name);
        if (passage !== undefined) {
          say(run, { passage, scope: site.scope, from: { from: 'said', at: site.at } });
        }
      }
    }
    for (const line of [...WORLD_LINES, ...PLACE_LINES]) {
      const passage = kind.passages.get(line.name);
      if (passage !== undefined) {
        say(run, { passage, scope: engineScope(line, passage.at), from: { from: 'engine', line } });
      }
    }
  }
  for (const site of setting.sites.rendered) rendered(run, site);
  drain(run);
  for (const { kind } of setting.speakers) {
    for (const passage of kind.passages.values()) {
      if (!run.reached.has(passage)) {
        say(run, { passage, scope: Scope.root(), from: { from: 'nowhere' } });
      }
    }
  }
  drain(run);
}

/** The declarations of every body a composed kind runs, whichever kind wrote each. */
function bodiesOf(kind: KindRef): Node[] {
  return [
    ...GUARD_NAMES.flatMap((name) => kind.guards[name].map((guard) => guard.declaration)),
    ...[...kind.plays.values()].flatMap((plays) => plays.map((play) => play.declaration)),
    ...[...kind.handlers.values()].flatMap((handlers) => handlers.map((one) => one.declaration)),
    ...[...kind.hooks.values()].flatMap((hooks) => hooks.map((hook) => hook.declaration)),
  ];
}

/** What the engine binds when it says `line`. */
function engineScope(line: EnginePassage, at: Span): Scope {
  return Object.entries(line.binds).reduce(
    (built, [name, binds]) => built.bounding(engineBinding(name, binds, at)),
    Scope.root(),
  );
}

function engineBinding(name: string, binds: EngineBinds, at: Span): Binding {
  return {
    name,
    type: binds === 'set' ? setOf(null) : OPEN_OBJECT,
    origin: 'parameter',
    at,
    writable: false,
  };
}

/** The passages still to check, and what has been checked and said. */
interface Run {
  readonly setting: PassageSetting;
  readonly queue: Saying[];
  /** Each passage, with the scopes it has been checked in. */
  readonly done: Map<ResolvedPassage, Set<string>>;
  /** Each passage said from somewhere. */
  readonly reached: Set<ResolvedPassage>;
  /** Each diagnostic told, so a passage said from many places is told of once. */
  readonly told: Set<string>;
  /** The composed kind that wrote each passage, where its names resolve. */
  readonly writers: ReadonlyMap<ResolvedPassage, Speaker>;
}

function runOver(setting: PassageSetting): Run {
  const writers = new Map<ResolvedPassage, Speaker>();
  for (const speaker of setting.speakers) {
    const own = kindName(speaker.kind);
    for (const passage of speaker.kind.passages.values()) {
      if (passage.origin === own && !writers.has(passage)) writers.set(passage, speaker);
    }
  }
  return { setting, queue: [], done: new Map(), reached: new Set(), told: new Set(), writers };
}

function say(run: Run, saying: Saying): void {
  run.reached.add(saying.passage);
  run.queue.push(saying);
}

/** A slot's passage, as every kind composing the slot's own has it. */
function rendered(run: Run, site: PassageRendered): void {
  for (const { kind } of run.setting.speakers) {
    if (!composesKind(kind, site.kind)) continue;
    const passage = kind.passages.get(site.name);
    if (passage !== undefined) {
      say(run, { passage, scope: site.scope, from: { from: 'rendered', at: site.at } });
    }
  }
}

/** Check what is queued, each passage once for each scope it is said in. */
function drain(run: Run): void {
  for (let saying = run.queue.pop(); saying !== undefined; saying = run.queue.pop()) {
    const key = signature(saying.scope);
    const done = run.done.get(saying.passage) ?? new Set<string>();
    if (done.has(key)) continue;
    done.add(key);
    run.done.set(saying.passage, done);
    checkSaying(run, saying);
  }
}

/** One passage in one scope, with its writer as `self`. */
function checkSaying(run: Run, { passage, scope, from }: Saying): void {
  const speaker = run.writers.get(passage);
  // A passage whose writer did not compose has been said of already.
  if (speaker === undefined) return;
  const self = speaker.kind;
  const withSelf = scope.carried(new Set(['self'])).bounding(selfBinding(self, passage.at));
  const diagnostics = new Diagnostics();
  const context: CheckContext = {
    scope: withSelf,
    kinds: run.setting.kinds,
    from: self.library,
    self,
    diagnostics,
    ...(speaker.names === undefined ? {} : { names: speaker.names }),
  };
  if (from.from !== 'nowhere') {
    const missing = unbound(passage.body.prose, context);
    if (missing.size > 0) {
      refuseUnbound(run, passage, missing, withSelf, from);
      return;
    }
  }
  const sites: PassageRendered[] = [];
  checkProse(passage.body.prose, context, {
    render: (site) => sites.push(site),
    option: (slot) => run.setting.sites.option(slot),
  });
  for (const diagnostic of diagnostics.all) tell(run, diagnostic);
  for (const site of sites) rendered(run, site);
}

/** Each diagnostic once, however many places the passage it is about is said from. */
function tell(run: Run, diagnostic: Diagnostic): void {
  const { at, message } = diagnostic;
  const key = `${at.source.name}:${at.start}:${at.end}:${message}`;
  if (run.told.has(key)) return;
  run.told.add(key);
  run.setting.diagnostics.add(diagnostic);
}

/** Names a passage renders that nothing binds where it is said: refused where it is said. */
function refuseUnbound(
  run: Run,
  passage: ResolvedPassage,
  missing: ReadonlyMap<string, Span>,
  scope: Scope,
  from: Exclude<From, { from: 'nowhere' }>,
): void {
  const names = [...missing.keys()];
  const slots = readable(names.map((name) => `{${name}}`));
  const called = readable(names);
  const diagnostics = new Diagnostics();
  if (from.from === 'engine') {
    const given = Object.keys(from.line.binds).map((name) => `{${name}}`);
    diagnostics.refuse(
      missing.get(names[0]!)!,
      `The engine says \`${passage.name}\` with ${given.length === 0 ? 'nothing' : readable(given)} bound, and nothing is called ${called} there.`,
      given.length === 0
        ? 'Take the slot out: the engine says this line with nothing bound but its own `self`.'
        : `Render what it is given: ${readable(given)}.`,
    );
  } else if (from.from === 'rendered') {
    diagnostics.refuse(
      from.at,
      `The passage \`${passage.name}\` renders ${slots}, and nothing it is rendered with is called ${called}.`,
      `A passage a slot renders is given only \`actor\` and \`here\`, where they are bound: say it from a body that binds ${called} instead.`,
    );
  } else {
    const inReach = scope
      .bound()
      .filter((binding) => binding.name !== 'self')
      .map((binding) => binding.name);
    diagnostics.refuse(
      from.at,
      `The passage \`${passage.name}\` renders ${slots}, and nothing here is called ${called}.`,
      `Say it where ${called} ${names.length === 1 ? 'is' : 'are'} bound, or give the words here in quotes.${inReach.length === 0 ? '' : ` In reach here: ${readable(inReach)}.`}`,
    );
  }
  for (const diagnostic of diagnostics.all) tell(run, diagnostic);
}

/** What a scope binds and withholds, as a key two sayings with the same scope share. */
function signature(scope: Scope): string {
  const bound = scope
    .bound()
    .map((binding) => `${binding.name}:${showBindingType(binding.type)}`)
    .sort();
  const withheld = scope
    .withheldNames()
    .map((name) => `~${name}`)
    .sort();
  return [...bound, ...withheld].join(',');
}

/**
 * The names a passage renders that nothing answers to in `context`: not
 * bound or withheld where it is said, not a loop's own, and not an
 * object named from where the passage is written. Each with where it is
 * first written.
 */
function unbound(prose: Prose, context: CheckContext): Map<string, Span> {
  const looped = new Set<string>();
  const used = new Map<string, Span>();
  walkProse(prose, (piece) => {
    if (piece.kind === 'prose-for') looped.add(piece.variable.text);
  });
  walkProse(prose, (piece) => {
    const exprs: Expr[] =
      piece.kind === 'prose-slot'
        ? [piece.expr]
        : piece.kind === 'prose-if'
          ? [piece.condition]
          : piece.kind === 'prose-for'
            ? [piece.over]
            : [];
    for (const expr of exprs) {
      for (const [name, at] of namesIn(expr)) if (!used.has(name)) used.set(name, at);
    }
  });
  const missing = new Map<string, Span>();
  for (const [name, at] of used) {
    if (name === 'self' || looped.has(name) || isLoopVariable(name)) continue;
    if (context.scope.lookup(name) !== null || context.scope.withheld(name) !== null) continue;
    if (namesAnObject(name, context.names)) continue;
    missing.set(name, at);
  }
  return missing;
}

/** Whether a name reaches an object from where a passage is written. */
function namesAnObject(name: string, names: NameScope | undefined): boolean {
  if (names === undefined) return false;
  const naming = nameFrom(names.source, names.vantage, [name]);
  return naming.names !== 'missing' && naming.names !== 'world-inside';
}

/** Every piece of prose, blocks' insides and each link of an `{if}` chain included. */
function walkProse(prose: Prose, visit: (piece: ProsePiece) => void): void {
  const stack: Prose[] = [prose];
  while (stack.length > 0) {
    for (const piece of stack.pop()!.pieces) {
      visit(piece);
      if (piece.kind === 'prose-for') stack.push(piece.body);
      if (piece.kind !== 'prose-if') continue;
      stack.push(piece.then);
      let otherwise: ProseIf['otherwise'] = piece.otherwise;
      while (otherwise !== null && otherwise.kind === 'prose-if') {
        visit(otherwise);
        stack.push(otherwise.then);
        otherwise = otherwise.otherwise;
      }
      if (otherwise !== null) stack.push(otherwise);
    }
  }
}

/** The names an expression reads, as bindings or through `bound`, each with where it is written. */
function namesIn(expr: Expr): [string, Span][] {
  const found: [string, Span][] = [];
  const stack: Expr[] = [expr];
  while (stack.length > 0) {
    const node = stack.pop()!;
    switch (node.kind) {
      case 'binding':
      case 'bound':
        found.push([node.name.text, node.name.at]);
        break;
      case 'binary':
        stack.push(node.right, node.left);
        break;
      case 'unary':
        stack.push(node.operand);
        break;
      case 'member':
        stack.push(node.receiver);
        break;
      case 'call':
        stack.push(...node.arguments, node.receiver);
        break;
      case 'free-call':
        stack.push(...node.arguments);
        break;
      default:
        break;
    }
  }
  return found;
}
