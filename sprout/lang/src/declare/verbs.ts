// A verb checked against itself (the spec's Verbs › Declaring a verb,
// Set roles, Optional tools, Value roles; Limits › Static caps): the
// first tier, where a declaration has to agree with itself and nothing
// else is in scope yet.
//
// Its roles and its phrases must agree: every slot names a role the verb
// declares, once per phrase, and every phrase names the first role, the
// target. The second half of B23 resolves a verb across libraries, and
// what `optional` means for each tool is computed there from the phrases.

import type {
  PhraseDeclaration,
  PhraseSlot,
  RoleDeclaration,
  VerbDeclaration,
} from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { textOf } from '../source/source.js';
import { readable } from '../source/words.js';
import { nearestOption } from './enums.js';

/** The host's figures for the spec's static caps that bound a verb. Never this layer's numbers. */
export interface VerbCaps {
  readonly rolesPerVerb: number;
  readonly phrasesPerVerb: number;
  readonly phraseCharacters: number;
}

/** One verb, checked against itself. */
export function checkVerbDeclaration(
  declared: VerbDeclaration,
  caps: VerbCaps,
  diagnostics: Diagnostics,
): void {
  const verb = declared.name.text;
  checkCaps(declared, caps, diagnostics);

  const roles = new Map<string, RoleDeclaration>();
  for (const role of declared.roles) {
    if (roles.has(role.name.text)) {
      diagnostics.refuse(
        role.name.at,
        `\`${verb}\` declares the role \`${role.name.text}\` twice.`,
        "A role's name is what a slot fills, so it is written once. Remove the second, or give it another name.",
      );
      continue;
    }
    roles.set(role.name.text, role);
    checkRole(declared, role, diagnostics);
  }

  const target = declared.roles[0];
  const seen = new Map<string, PhraseDeclaration>();
  for (const phrase of declared.phrases) {
    const written = textOf(phrase.at);
    if (phrase.parts.length === 0) {
      diagnostics.refuse(
        phrase.at,
        `\`${verb}\` has a phrase with no words in it.`,
        `Write the words a visitor types, as in \`"${verb} [target]"\`, or take the phrase out.`,
      );
      continue;
    }
    const key = meaningOf(phrase);
    if (seen.has(key)) {
      diagnostics.refuse(
        phrase.at,
        `\`${verb}\` has the phrase \`${written}\` twice.`,
        'A phrase is written once. Remove the second.',
      );
      continue;
    }
    seen.set(key, phrase);

    const filled = new Set<string>();
    let named = true;
    for (const slot of phrase.parts.filter(isSlot)) {
      const role = slot.role.text;
      if (!roles.has(role)) {
        named = false;
        unknownRole(declared, written, slot, diagnostics);
        continue;
      }
      if (filled.has(role)) {
        diagnostics.refuse(
          slot.at,
          `\`${written}\` fills \`${role}\` twice.`,
          'A phrase fills each role once. Name another role in one of the slots, or take one out.',
        );
        continue;
      }
      filled.add(role);
    }
    // A phrase that named a role the verb lacks has been refused for it,
    // and may well have meant the target there.
    if (named && target !== undefined && !filled.has(target.name.text)) {
      diagnostics.refuse(
        phrase.at,
        `\`${written}\` leaves out \`${target.name.text}\`, the role \`${verb}\` is done to.`,
        `Every phrase names the first role, as \`"${verb} [${target.name.text}]"\` does.`,
      );
    }
  }
}

/**
 * The caps that bound one verb, each said once at the first thing past
 * it: how many a verb holds is one fact about one verb.
 */
function checkCaps(declared: VerbDeclaration, caps: VerbCaps, diagnostics: Diagnostics): void {
  const verb = declared.name.text;
  const role = declared.roles[caps.rolesPerVerb];
  if (role !== undefined) {
    diagnostics.refuse(
      role.at,
      `\`${verb}\` has ${declared.roles.length} roles, and ${caps.rolesPerVerb} is as many as a verb may have.`,
      'Take some out. A set role, marked `many`, counts as one however many things it binds.',
    );
  }
  const phrase = declared.phrases[caps.phrasesPerVerb];
  if (phrase !== undefined) {
    diagnostics.refuse(
      phrase.at,
      `\`${verb}\` has ${declared.phrases.length} phrases, and ${caps.phrasesPerVerb} is as many as a verb may have.`,
      'Keep the ways of saying it a visitor is most likely to type, and take the rest out.',
    );
  }
  for (const each of declared.phrases) {
    // Counted as the phrase means it, after escapes, since that is what
    // a visitor would type.
    const length = [...each.text].length;
    if (length > caps.phraseCharacters) {
      diagnostics.refuse(
        each.at,
        `This phrase is ${length} characters long, and ${caps.phraseCharacters} is as long as a phrase may be.`,
        'Say it in fewer words: a phrase is what a visitor types.',
      );
    }
  }
}

/** What a role's own modifiers must agree with: its filler, its place, and the verb's phrases. */
function checkRole(
  declared: VerbDeclaration,
  role: RoleDeclaration,
  diagnostics: Diagnostics,
): void {
  const verb = declared.name.text;
  const name = role.name.text;
  const value = role.filler?.kind === 'value-filler' ? role.filler.value : null;
  if (role.many !== null && value !== null) {
    diagnostics.refuse(
      role.many.at,
      `\`${name}\` is ${value === 'symbol' ? 'a' : 'an'} \`${value}\` role, and a value role is single.`,
      'Several values are several roles; take `many` off.',
    );
  }
  if (role.optional === null) return;
  if (declared.phrases.length > 0) {
    diagnostics.refuse(
      role.optional.at,
      `\`${name}\` is marked \`optional\`, and \`${verb}\` has phrases, so its phrases decide.`,
      'A tool some phrase leaves out is optional already; `optional` is written only on a verb with no phrases. Remove it.',
    );
  } else if (declared.roles[0] === role) {
    diagnostics.refuse(
      role.optional.at,
      `\`${name}\` is the role \`${verb}\` is done to, and the target is never optional.`,
      '`optional` is for a tool, a role after the first. Remove it.',
    );
  }
}

/** A slot naming a role the verb does not declare, said with what it may name instead. */
function unknownRole(
  declared: VerbDeclaration,
  written: string,
  slot: PhraseSlot,
  diagnostics: Diagnostics,
): void {
  const verb = declared.name.text;
  const role = slot.role.text;
  const names = [...new Set(declared.roles.map((r) => r.name.text))];
  if (names.length === 0) {
    diagnostics.refuse(
      slot.at,
      `\`${written}\` names \`${role}\`, and \`${verb}\` has no roles.`,
      `Take the slot out, or add \`role ${role}\`.`,
    );
    return;
  }
  const meant = names.length === 1 ? names[0]! : nearestOption(role, names);
  const its = `Its ${names.length === 1 ? 'role is' : 'roles are'} ${readable(names)}.`;
  diagnostics.refuse(
    slot.at,
    `\`${written}\` names \`${role}\`, and \`${verb}\` has no such role.`,
    meant === null
      ? `${its} Name one of them, or add \`role ${role}\`.`
      : `${its} Write \`[${meant}]\`, or add \`role ${role}\`.`,
  );
}

function isSlot(part: PhraseDeclaration['parts'][number]): part is PhraseSlot {
  return part.kind === 'phrase-slot';
}

/** A phrase as it means, for telling two apart: its words as words and its slots by role. */
function meaningOf(phrase: PhraseDeclaration): string {
  return phrase.parts
    .map((part) => (part.kind === 'phrase-slot' ? `[${part.role.text}]` : part.text))
    .join(' ');
}
