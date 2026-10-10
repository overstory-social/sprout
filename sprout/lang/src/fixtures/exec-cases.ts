// The shapes of a statement golden's cases, and the rewrites a few of them make to the
// bundle before it is made, for a body the checker would refuse. Spec support: the
// package build leaves it out.

import type { RuntimeBudgets, StaticCaps } from '../bundle/limits.js';

/** The names a case gives an object a state builder made. */
export type Named = 'visitor' | 'ines' | 'pat' | 'spark' | 'bubble' | 'crate' | 'lid';

/** Who an object a case names is: a path in the tree, or one the state builder made. */
export type Who = readonly string[] | Named;

export type StateName = 'fresh' | 'worn' | 'closed';

/** What one case asks: a body, run as `self` in a state, names bound, then the queue drained. */
export interface Case {
  readonly name: string;
  readonly area: string;
  /** The body's statements, written as the handler's or the play's. */
  readonly body: string;
  /** The kind whose handler `:c<n>` holds the body; `Runner` unless given. */
  readonly kind?: string;
  /** Written as the `do` of a play of the kind, where `actor` and `here` are bound. */
  readonly play?: true;
  /** The object whose body this is; the runner unless given. */
  readonly self?: Who;
  /** Names bound in the frame: the handler's `who`, or a play's `actor`. */
  readonly bind?: Readonly<Record<string, Who>>;
  readonly state?: StateName;
  readonly seed?: number;
  readonly budgets?: Partial<RuntimeBudgets>;
  readonly caps?: Partial<StaticCaps>;
  /** Who reads what the body says, and from whom it is heard. */
  readonly heard?: readonly Who[];
  readonly speaker?: Who;
  readonly leftOut?: readonly Who[];
  readonly records?: 'as-said' | 'as-told';
  /** Rewrites the bundle's nodes before the cartridge is made, for a body the checker would refuse. */
  readonly patch?: (node: Record<string, unknown>) => void;
  /** The most instances the host will hold beyond those the state starts with; unbounded unless given. */
  readonly holds?: number;
  /** Compiled and located but not run: the C runtime's own specs run it where the oracle's pass is not yet built there. */
  readonly unrun?: true;
  /** A body run first in the same turn, so that what it destroyed is bound by the case's own. */
  readonly prior?: { readonly kind: string; readonly self: Who; readonly body: string };
}

export const HALL = ['hall'];
export const at = (...path: string[]): readonly string[] => ['hall', ...path];

/** Turns a call's receiver `self` into a name the frame binds, so a body writes through another object. */
export function throughBystander(node: Record<string, unknown>): void {
  const args = node['arguments'];
  const receiver = node['receiver'] as Record<string, unknown> | undefined;
  if (
    node['kind'] === 'call' &&
    Array.isArray(args) &&
    (args[1] as Record<string, unknown> | undefined)?.['value'] === 7 &&
    receiver?.['kind'] === 'binding'
  ) {
    (receiver['name'] as { text: string }).text = 'bystander';
  }
}

/** Turns the `tell` of a given line into a `text`, which only a `describe` may hold. */
export function intoText(node: Record<string, unknown>): void {
  const said = node['said'] as Record<string, unknown> | undefined;
  if (node['kind'] === 'tell' && said?.['value'] === 'Text stands in.') node['kind'] = 'text';
}

/** What one walk asks: the objects in range of `asker` for a message, or for any. */
export interface RangeCase {
  readonly name: string;
  readonly asker: Who;
  /** A message of the bench, or any question when null. */
  readonly asking: string | null;
  readonly state: StateName;
}
