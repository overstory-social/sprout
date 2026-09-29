// Intents (the spec's Parsing › Intents; Limits › Static caps). Reading
// its file checks an intent against itself: it has steps, at most as many
// as the host allows, its phrases are held to a verb's caps, and every
// slot a phrase names is given to a role in some step, as every slot a
// step gives is named in some phrase. Across the bundle, each step's verb
// is found from the intent's library, every role it gives is one the verb
// declares and holds things, and every role the verb needs is given; a
// world's intent of a library intent's name replaces the library's. What
// a slot may hold is what fills a role it is given to in any step. A
// step's `when` is checked as a guard is (`check/intents.ts`).

import type { Expr } from '../syntax/ast.js';
import type { IntentDeclaration, IntentStep, PhraseDeclaration } from '../syntax/ast-verbs.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { textOf } from '../source/source.js';
import { nearestOption, qualifiedName } from './enums.js';
import type { ResolvedPhrase, ResolvedPhrasePart, ResolvedRole, ResolvedVerb } from './verbs.js';

/** The host's figures for the caps that bound an intent. Never this layer's numbers. */
export interface IntentCaps {
  readonly phrasesPerVerb: number;
  readonly phraseCharacters: number;
  readonly stepsPerIntent: number;
}

/** The slots a phrase of `declared` names, in the order written. */
function slotsOf(phrase: PhraseDeclaration): string[] {
  return phrase.parts.flatMap((part) => (part.kind === 'phrase-slot' ? [part.role.text] : []));
}

/** An intent checked against itself, as its file is read. */
export function checkIntentDeclaration(
  declared: IntentDeclaration,
  caps: IntentCaps,
  diagnostics: Diagnostics,
): void {
  const intent = declared.name.text;
  // A phrase or step that could not be read has been refused already, and
  // what the rest must agree on is not asked of what is left.
  const { whole } = declared;
  if (whole && declared.steps.length === 0) {
    diagnostics.refuse(
      declared.name.at,
      `\`${intent}\` has no steps.`,
      'Write what it stands for after `do`, as in `do unlock (target: y, tool: x) then open (target: y)`.',
    );
  }
  const extra = declared.steps[caps.stepsPerIntent];
  if (extra !== undefined) {
    diagnostics.refuse(
      extra.at,
      `\`${intent}\` has ${declared.steps.length} steps, and ${caps.stepsPerIntent} is as many as an intent may have.`,
      'Keep the steps the line most needs, and take the rest out.',
    );
  }
  if (whole && declared.phrases.length === 0) {
    diagnostics.refuse(
      declared.name.at,
      `\`${intent}\` has no phrase a visitor could type.`,
      'Write its phrases in quotes, the canonical one first, as in `"open [y] with [x]"`.',
    );
  }
  const morePhrase = declared.phrases[caps.phrasesPerVerb];
  if (morePhrase !== undefined) {
    diagnostics.refuse(
      morePhrase.at,
      `\`${intent}\` has ${declared.phrases.length} phrases, and ${caps.phrasesPerVerb} is as many as an intent may have.`,
      'Keep the ways of saying it a visitor is most likely to type, and take the rest out.',
    );
  }
  const given = new Set(declared.steps.flatMap((step) => step.fillers.map((one) => one.slot.text)));
  const named = new Set(declared.phrases.flatMap(slotsOf));
  const agreeing = whole && declared.steps.length > 0 && declared.phrases.length > 0;
  const seen = new Set<string>();
  for (const phrase of declared.phrases) {
    const written = textOf(phrase.at);
    const length = [...phrase.text].length;
    if (length > caps.phraseCharacters) {
      diagnostics.refuse(
        phrase.at,
        `This phrase is ${length} characters long, and ${caps.phraseCharacters} is as long as a phrase may be.`,
        'Say it in fewer words: a phrase is what a visitor types.',
      );
    }
    if (phrase.parts.length === 0) {
      diagnostics.refuse(
        phrase.at,
        `\`${intent}\` has a phrase with no words in it.`,
        'Write the words a visitor types, or take the phrase out.',
      );
      continue;
    }
    const key = phrase.parts
      .map((part) => (part.kind === 'phrase-slot' ? `[${part.role.text}]` : part.text))
      .join(' ');
    if (seen.has(key)) {
      diagnostics.refuse(
        phrase.at,
        `\`${intent}\` has the phrase \`${written}\` twice.`,
        'A phrase is written once. Remove the second.',
      );
      continue;
    }
    seen.add(key);
    const once = new Set<string>();
    for (const part of phrase.parts) {
      if (part.kind !== 'phrase-slot') continue;
      const slot = part.role.text;
      if (once.has(slot)) {
        diagnostics.refuse(
          part.at,
          `\`${written}\` names \`${slot}\` twice.`,
          'A phrase names each slot once. Name another in one of them, or take one out.',
        );
      }
      once.add(slot);
      if (agreeing && !given.has(slot)) {
        diagnostics.refuse(
          part.at,
          `\`${written}\` names \`${slot}\`, and no step of \`${intent}\` gives it a role.`,
          `Give it to a role in a step, as in \`do open (target: ${slot})\`, or take the slot out.`,
        );
      }
    }
  }
  for (const step of declared.steps) {
    const roles = new Set<string>();
    for (const filler of step.fillers) {
      if (roles.has(filler.role.text)) {
        diagnostics.refuse(
          filler.role.at,
          `This step gives \`${filler.role.text}\` twice.`,
          'Give each role of the verb one slot.',
        );
      }
      roles.add(filler.role.text);
      if (agreeing && !named.has(filler.slot.text)) {
        diagnostics.refuse(
          filler.slot.at,
          `\`${filler.slot.text}\` fills a role, and no phrase of \`${intent}\` names it, so nothing could fill it.`,
          `Name it in a phrase in brackets, as in \`"open [${filler.slot.text}]"\`, or give the role a slot a phrase names.`,
        );
      }
    }
  }
}

/** One step of an intent, as the bundle resolves it. */
export interface ResolvedIntentStep {
  readonly verb: ResolvedVerb;
  /** Each role the step gives, by name, and the slot, by index, that fills it. */
  readonly fillers: ReadonlyMap<string, number>;
  /** The condition read before the line runs; null where the step always runs. */
  readonly when: Expr | null;
  readonly declaration: IntentStep;
}

/** An intent as the whole bundle sees it. */
export interface ResolvedIntent {
  readonly library: string;
  readonly name: string;
  /** Its slots, by name, in the order its phrases first name them. */
  readonly slots: readonly string[];
  /** Each slot's roles, in the steps it is given to: what may fill it is what fills any of them. */
  readonly slotRoles: readonly (readonly ResolvedRole[])[];
  /** Its phrases, each slot by its index among `slots`. */
  readonly phrases: readonly ResolvedPhrase[];
  readonly steps: readonly ResolvedIntentStep[];
  readonly declaration: IntentDeclaration;
}

/** What resolving intents reads: the verbs, found from a library, and the names a misspelt verb may have meant. */
export interface IntentContext {
  readonly verbs: { unqualified(name: string, from: string): ResolvedVerb | null };
  readonly named: (from: string) => readonly string[];
  readonly diagnostics: Diagnostics;
}

/** Every intent the bundle declares, a world's replacing a library's of its name. */
export class IntentTable {
  private readonly byQualified = new Map<string, ResolvedIntent>();

  /** Add `library`'s intents, resolving each; one whose steps cannot be resolved is left out, having said why. */
  add(library: string, declarations: readonly IntentDeclaration[], context: IntentContext): void {
    for (const declared of declarations) {
      const resolved = resolveIntent(library, declared, context);
      if (resolved !== null)
        this.byQualified.set(qualifiedName(library, declared.name.text), resolved);
    }
  }

  /** The intents a visitor of `world` may type: each of the world's, and each library's no intent of the world's replaces. */
  typed(world: string): ResolvedIntent[] {
    const all = [...this.byQualified.values()];
    const own = new Set(all.filter((one) => one.library === world).map((one) => one.name));
    return all.filter((one) => one.library === world || !own.has(one.name));
  }

  /** Every intent the bundle declares, in the order added. */
  all(): readonly ResolvedIntent[] {
    return [...this.byQualified.values()];
  }
}

/** One intent resolved in `library`; null where a step could not be, having said why. */
function resolveIntent(
  library: string,
  declared: IntentDeclaration,
  context: IntentContext,
): ResolvedIntent | null {
  const { diagnostics } = context;
  const slots: string[] = [];
  for (const phrase of declared.phrases) {
    for (const slot of slotsOf(phrase)) if (!slots.includes(slot)) slots.push(slot);
  }
  const slotRoles: ResolvedRole[][] = slots.map(() => []);
  const steps: ResolvedIntentStep[] = [];
  let resolved = true;
  for (const step of declared.steps) {
    const verb = context.verbs.unqualified(step.verb.text, library);
    if (verb === null) {
      const meant = nearestOption(step.verb.text, context.named(library));
      diagnostics.refuse(
        step.verb.at,
        `This step performs \`${step.verb.text}\`, and nothing declares that verb.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
        meant === null
          ? 'Name a verb this world or a library it uses declares.'
          : `Write \`${meant}\`.`,
      );
      resolved = false;
      continue;
    }
    const fillers = new Map<string, number>();
    let misnamed = false;
    for (const filler of step.fillers) {
      const role = verb.roles.find((one) => one.name === filler.role.text);
      if (role === undefined) {
        misnamed = true;
        diagnostics.refuse(
          filler.role.at,
          `\`${verb.name}\` has no role \`${filler.role.text}\`.`,
          `Give one of the roles it declares: ${verb.roles.map((one) => `\`${one.name}\``).join(', ') || 'it has none'}.`,
        );
        resolved = false;
        continue;
      }
      const fills = role.filler?.fills;
      if (fills === 'symbol' || fills === 'integer' || fills === 'exit') {
        diagnostics.refuse(
          filler.role.at,
          `\`${role.name}\` of \`${verb.name}\` takes ${fills === 'exit' ? 'a way out' : 'a value'}, and a slot of an intent holds a thing.`,
          'Give a step only the roles a thing fills.',
        );
        resolved = false;
        continue;
      }
      const slot = slots.indexOf(filler.slot.text);
      if (slot < 0) continue;
      fillers.set(role.name, slot);
      slotRoles[slot]!.push(role);
    }
    // A role written under a name the verb lacks is most likely the one it
    // needs, misspelled, and has been refused already.
    const written = new Set(step.fillers.map((one) => one.role.text));
    for (const role of misnamed ? [] : verb.roles) {
      if (written.has(role.name) || role.optional) continue;
      const fills = role.filler?.fills;
      const value = fills === 'symbol' || fills === 'integer' || fills === 'exit';
      diagnostics.refuse(
        step.verb.at,
        value
          ? `This step performs \`${verb.name}\`, which needs \`${role.name}\`, ${fills === 'exit' ? 'a way out' : 'a value'}, and a slot of an intent holds a thing.`
          : `This step performs \`${verb.name}\` and gives no slot to \`${role.name}\`, which it needs.`,
        value
          ? 'Perform a verb whose needed roles a thing fills.'
          : `Give it one, as in \`${verb.name} (${role.name}: y)\`.`,
      );
      resolved = false;
    }
    steps.push({ verb, fillers, when: step.when, declaration: step });
  }
  if (!resolved) return null;
  const phrases = declared.phrases.map((phrase): ResolvedPhrase => ({
    text: phrase.text,
    parts: phrase.parts.flatMap((part): ResolvedPhrasePart[] => {
      if (part.kind === 'phrase-words') return [{ part: 'words', text: part.text }];
      return [{ part: 'slot', role: slots.indexOf(part.role.text) }];
    }),
    declaration: phrase,
  }));
  return {
    library,
    name: declared.name.text,
    slots,
    slotRoles,
    phrases,
    steps,
    declaration: declared,
  };
}
