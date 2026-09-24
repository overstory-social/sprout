// A composed kind's pass rules (the spec's Events, messages and the bus ›
// Containers route; Kinds › How members combine, the row "`pass :m`,
// `pass any`: refuse"). A pass rule is exclusive: one per message, and one
// `pass any`. The composer's own replaces what it composes; otherwise the
// one source of a rule applies, and two sources are refused, since a
// container that relays and one that refuses cannot both be its policy.
// A rule is keyed by `messageKey`, resolved from the library that wrote it.

import type { KindExpr, KindMember } from '../syntax/ast.js';
import { writtenPass, type PassDeclaration } from '../syntax/ast-events.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { namedMessage, type MessageSetting } from './handlers.js';
import { messageKey } from './messages.js';

/** One kind's pass rule, as a composed kind asks it. */
export interface ResolvedPass {
  /** The kind that wrote it, by qualified name. */
  readonly origin: string;
  readonly declaration: PassDeclaration;
}

/** What a composed kind answers: `pass any`, and `pass :m` for each message it names. */
export interface PassRules {
  readonly any: ResolvedPass | null;
  /** By `messageKey`. */
  readonly messages: ReadonlyMap<string, ResolvedPass>;
}

/** A kind with no pass rule anywhere in its closure: a container of it relays everything. */
export const NO_PASS_RULES: PassRules = { any: null, messages: new Map() };

/**
 * The rules a composer's own body writes. One written twice is refused
 * at the second, which is dropped; one whose message nothing declares is
 * dropped having said so.
 */
export function ownPassRules(
  composer: string,
  members: readonly KindMember[],
  origin: string,
  setting: MessageSetting,
): PassRules {
  let any: ResolvedPass | null = null;
  const messages = new Map<string, ResolvedPass>();
  const twice = (pass: PassDeclaration): void => {
    setting.diagnostics.refuse(
      pass.at,
      `\`${composer}\` writes \`${writtenPass(pass)}\` twice.`,
      `A container answers once for each message. Keep one \`${writtenPass(pass)}\`, and write what both say as one condition.`,
    );
  };
  for (const member of members) {
    if (member.kind !== 'pass') continue;
    if (member.message === null) {
      if (any !== null) twice(member);
      else any = { origin, declaration: member };
      continue;
    }
    const message = namedMessage(member.message, setting);
    if (message === null) continue;
    const key = messageKey(message);
    if (messages.has(key)) twice(member);
    else messages.set(key, { origin, declaration: member });
  }
  return { any, messages };
}

/** A composed kind's rules, with the kind as written that brought them. */
export interface ComposedRules {
  readonly rules: PassRules;
  readonly written: KindExpr;
}

/**
 * The rules a composer answers with: its own for each message it writes
 * one for, else the one source's; two sources are refused at the kind, as
 * written, that brought the second, and the first is kept. `shown` names
 * an origin as a message does.
 */
export function composePassRules(
  composer: string,
  composed: readonly ComposedRules[],
  own: PassRules,
  shown: (origin: string) => string,
  diagnostics: Diagnostics,
): PassRules {
  const pick = (
    arrivals: readonly { readonly rule: ResolvedPass; readonly through: KindExpr }[],
    mine: ResolvedPass | null | undefined,
  ): ResolvedPass | null => {
    if (mine !== null && mine !== undefined) return mine;
    const origins: { readonly rule: ResolvedPass; readonly through: KindExpr }[] = [];
    for (const one of arrivals) {
      if (!origins.some((seen) => seen.rule.origin === one.rule.origin)) origins.push(one);
    }
    const [first, second] = origins;
    if (first === undefined) return null;
    if (second !== undefined) {
      const written = writtenPass(first.rule.declaration);
      diagnostics.refuse(
        second.through.at,
        `\`${composer}\` gets \`${written}\` from both \`${shown(first.rule.origin)}\` and \`${shown(second.rule.origin)}\`, and a container has one rule for each message.`,
        `Write \`${written} (…)\` in \`${composer}\` to say which applies.`,
      );
    }
    return first.rule;
  };

  const any = pick(
    composed.flatMap(({ rules, written }) =>
      rules.any === null ? [] : [{ rule: rules.any, through: written }],
    ),
    own.any,
  );
  const keys = new Set<string>(own.messages.keys());
  for (const { rules } of composed) for (const key of rules.messages.keys()) keys.add(key);
  const messages = new Map<string, ResolvedPass>();
  for (const key of keys) {
    const picked = pick(
      composed.flatMap(({ rules, written }) => {
        const rule = rules.messages.get(key);
        return rule === undefined ? [] : [{ rule, through: written }];
      }),
      own.messages.get(key),
    );
    if (picked !== null) messages.set(key, picked);
  }
  return { any, messages };
}
