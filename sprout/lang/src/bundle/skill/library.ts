// The standard library as the generated skill describes it (the spec's
// The compiler › The generated skill; A worked microworld › The standard
// library it needs; Events › Containers route): its verbs and their
// phrases, what each of its kinds is made of, the engine's messages and
// the library's pass rules, and its source. All of it is read from the
// library as this compiler compiled it, so the skill describes the
// library that travels, never one remembered.

import { blocks, code, fenced, heading, table } from './markdown.js';
import type { Bundle } from '../bundle.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { ENGINE_MESSAGES } from '../../declare/engine-messages.js';
import { qualifiedName, SPROUT } from '../../declare/enums.js';
import { kindName, type KindRef } from '../../declare/kinds.js';
import { showType } from '../../declare/types.js';
import { ENGINE_VERBS, type ResolvedRole, type ResolvedVerb } from '../../declare/verbs.js';
import { textOf } from '../../source/source.js';

/** A role as its verb writes it, without the word `role`: `container: Container`. */
function roleWritten(role: ResolvedRole): string {
  return textOf(role.declaration.at).replace(/^role\s+/, '');
}

/** The library's kinds, in the order it declares them. */
export function libraryKinds(bundle: Bundle): KindRef[] {
  return bundle.kinds.filter((kind) => kind.library === SPROUT);
}

/** The library's verbs, in the order it declares them. */
export function libraryVerbs(bundle: Bundle): ResolvedVerb[] {
  return bundle.verbs.all().filter((verb) => verb.library === SPROUT);
}

/** Every role of `verb` a library kind plays in its own body, as `sprout.Actor as actor`. */
function playedBy(verb: ResolvedVerb, kinds: readonly KindRef[]): string[] {
  const played: string[] = [];
  for (const kind of kinds) {
    for (const plays of kind.plays.values()) {
      for (const play of plays) {
        if (play.origin !== kindName(kind)) continue;
        if (play.library !== verb.library || play.verb !== verb.name) continue;
        played.push(`${code(kindName(kind))} as ${code(play.role)}`);
      }
    }
  }
  return played;
}

/** What a visitor can type: every verb of the library's, its roles, its phrases and who answers it. */
export function verbsSection(bundle: Bundle): string {
  const kinds = libraryKinds(bundle);
  const rows = libraryVerbs(bundle).map((verb) => {
    const roles =
      verb.roles.length === 0 ? '—' : verb.roles.map((role) => code(roleWritten(role))).join(', ');
    const phrases = verb.phrases.map((phrase) => code(`"${phrase.text}"`)).join(' ');
    const engine = ENGINE_VERBS.includes(verb.name);
    const answers = engine
      ? 'the engine'
      : playedBy(verb, kinds).join(', ') || 'a world’s own kinds';
    return [code(verb.name), roles, phrases, answers];
  });
  return blocks(
    heading(2, 'What a visitor can type'),
    'These are the standard library’s verbs; a world adds its own with `verb`, and a kind takes part ' +
      'in one with `as <role> for <verb> { permit { … } do { … } }`. A phrase’s `[slot]` is filled by ' +
      'the role of that name, and phrases are tried in the order written.',
    table(['verb', 'roles', 'phrases', 'answered by'], rows),
  );
}

/** What one library kind holds, is made of and does, and the passages it says. */
function kindShown(kind: KindRef): string {
  const composes = kind.order.filter((name) => name !== kindName(kind));
  const holds = kind.containsActors ? 'things and people' : kind.contains ? 'things' : 'nothing';
  const facts: string[] = [
    `composes ${composes.length === 0 ? 'nothing' : composes.map(code).join(', ')}`,
    `holds ${holds}`,
  ];
  const properties = [...kind.properties.values()]
    .filter((property) => property.origin === kindName(kind))
    .map((property) => {
      const given = property.declaration.default;
      const shown = given === null ? '' : ` = ${code(textOf(given.at))}`;
      return `${code(`:${property.name}`)} ${showType(property.type)}${shown}`;
    });
  if (properties.length > 0) facts.push(`properties ${properties.join(', ')}`);
  const guards = (['depart', 'release', 'accept'] as const).filter((guard) =>
    kind.guards[guard].some((one) => one.origin === kindName(kind)),
  );
  if (guards.length > 0) facts.push(`guards ${guards.map(code).join(', ')}`);
  const plays = [...kind.plays.values()]
    .flat()
    .filter((play) => play.origin === kindName(kind))
    .map((play) => code(`as ${play.role} for ${play.verb}`));
  if (plays.length > 0) facts.push(`plays ${plays.join(', ')}`);
  const passes = [kind.passes.any, ...kind.passes.messages.values()]
    .filter((pass) => pass !== null && pass.origin === kindName(kind))
    .map((pass) => code(textOf(pass!.declaration.at)));
  if (passes.length > 0) facts.push(`routes ${passes.join(', ')}`);
  const passages = [...kind.passages.values()]
    .filter((passage) => passage.origin === kindName(kind))
    .map((passage) => [code(passage.name), passage.yields ? 'yes' : '—', passage.body.text.trim()]);
  return blocks(
    heading(3, code(kindName(kind))),
    facts.map((fact) => `- ${fact}`).join('\n'),
    passages.length === 0 ? '' : table(['passage', 'default', 'words'], passages),
  );
}

/** Composition: every kind of the library's, what it is made of and what it gives whatever composes it. */
export function compositionSection(bundle: Bundle): string {
  return blocks(
    heading(2, 'Composing the library’s kinds'),
    'A kind composes others with `is`: `kind TypeCase is sprout.Container, sprout.Lockable { … }`. ' +
      'Properties merge, guards and roles all run, and a `default` passage gives way to one of the same ' +
      'name written anywhere else, so a world or a kind replaces a stock line by writing its own.',
    ...libraryKinds(bundle).map(kindShown),
  );
}

/** Routing: the engine's own messages, what each hands a handler, and how containers pass messages on. */
export function routingSection(bundle: Bundle): string {
  const rows = ENGINE_MESSAGES.map((message) => {
    const parameters = message.parameters.map((parameter) => parameter.name).join(', ');
    return [
      code(`on :${message.name} (${parameters}) { … }`),
      message.parameters.map((p) => `${code(p.name)} ${p.binds}`).join(', '),
    ];
  });
  const declared = bundle.messages.all().filter((message) => message.library === SPROUT);
  return blocks(
    heading(2, 'Routing: messages and pass rules'),
    'A world declares its messages with `message :stir` or `message :lit with boolean`, sends one with ' +
      '`send <thing> :stir` or `broadcast :stir`, and answers one with `on :stir (from, value) { … }`. ' +
      'A container decides what passes through it with `pass :stir (…)` and `pass any (…)`; the ' +
      'library’s rules are under each kind above. The engine sends these itself:',
    table(['handler', 'binds'], rows),
    declared.length === 0
      ? `The standard library declares no messages of its own.`
      : `The standard library declares ${declared.map((message) => code(`:${qualifiedName(message.library, message.name)}`)).join(', ')}.`,
  );
}

/** The library's source, file by file, as it travels with every world. */
export function librarySourceSection(): string {
  return blocks(
    heading(2, 'The standard library’s source'),
    `\`${STANDARD_LIBRARY.name}\` ${STANDARD_LIBRARY.version} is written in Sprout, and is what every ` +
      'world composes and types against.',
    ...STANDARD_LIBRARY.files.map((file) =>
      blocks(`${code(file.name)}:`, fenced('sprout', file.text)),
    ),
  );
}
