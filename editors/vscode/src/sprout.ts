// The TextMate grammar for `.sprout` files (the spec's The compiler ›
// Lexical rules, and the syntax its Names, Properties, Verbs, Prose and
// Extensions sections write). The reserved words come from the compiler's
// own list. Inline passages and the quoted text of `say`, `tell`, `text`
// and `refuse` are read by the prose grammar, so slots colour there as in
// a `.prose` file; every other quoted text is plain, as the spec says a
// name, a noun or a label is.

import { LITERALS, TYPE_NAMES, syntaxWords, wordsPattern } from './keywords.ts';
import { type Grammar, type Rule, SCHEMA, named } from './rule.ts';

const S = 'sprout';
const PROSE = 'source.sprout-prose';

const NAME = '[a-z_][a-z0-9_]*';
const TYPE = '[A-Z][A-Za-z0-9_]*';

const COMMENTS: readonly Rule[] = [
  {
    name: `comment.block.${S}`,
    begin: '/\\*',
    end: '\\*/',
    beginCaptures: { '0': { name: `punctuation.definition.comment.begin.${S}` } },
    endCaptures: { '0': { name: `punctuation.definition.comment.end.${S}` } },
  },
  {
    name: `comment.line.double-slash.${S}`,
    begin: '//',
    end: '$',
    beginCaptures: { '0': { name: `punctuation.definition.comment.${S}` } },
  },
];

const ESCAPES: readonly Rule[] = [
  { name: `constant.character.escape.${S}`, match: '\\\\["\\\\n{]' },
  { match: '\\\\.' },
];

/** Quoted text, which does not run past its line. */
function quoted(name: string, patterns: readonly Rule[]): Rule {
  return {
    name,
    begin: '"',
    end: '"|$',
    beginCaptures: { '0': { name: `punctuation.definition.string.begin.${S}` } },
    endCaptures: { '0': { name: `punctuation.definition.string.end.${S}` } },
    patterns,
  };
}

/** `[role]` in a verb's phrase. */
const ROLE_SLOT: Rule = {
  match: `(\\[)\\s*(${NAME})\\s*(\\])`,
  captures: named(
    `punctuation.definition.role.begin.${S}`,
    `variable.parameter.role.${S}`,
    `punctuation.definition.role.end.${S}`,
  ),
};

const KEYWORD = `keyword.other.${S}`;

/** The declarations whose heads name something. */
const DECLARATIONS: readonly Rule[] = [
  {
    match: `^\\s*(extension)\\s+(${NAME})\\s+([0-9]+)\\b`,
    captures: named(KEYWORD, `entity.name.namespace.${S}`, `constant.numeric.integer.${S}`),
  },
  {
    match: `\\b(kind)\\s+([A-Za-z_][A-Za-z0-9_]*)`,
    captures: named(KEYWORD, `entity.name.type.kind.${S}`),
  },
  {
    name: `meta.enum.${S}`,
    begin: `\\b(enum)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*(\\{)`,
    end: '\\}',
    beginCaptures: named(
      KEYWORD,
      `entity.name.type.enum.${S}`,
      `punctuation.section.block.begin.${S}`,
    ),
    endCaptures: { '0': { name: `punctuation.section.block.end.${S}` } },
    patterns: [
      ...COMMENTS,
      { name: `variable.other.enummember.${S}`, match: `\\b${NAME}\\b` },
      { name: `punctuation.separator.${S}`, match: ',' },
    ],
  },
  {
    match: `\\b(enum)\\s+([A-Za-z_][A-Za-z0-9_]*)`,
    captures: named(KEYWORD, `entity.name.type.enum.${S}`),
  },
  {
    match: `^\\s*(world|object)\\s+(${NAME})`,
    captures: named(KEYWORD, `entity.name.tag.object.${S}`),
  },
  {
    match: `\\b(message)\\s+(:)([a-z][a-z0-9_]*)`,
    captures: named(
      KEYWORD,
      `punctuation.definition.symbol.${S}`,
      `constant.other.symbol.${S} entity.name.function.message.${S}`,
    ),
  },
  {
    name: `meta.verb.${S}`,
    begin: `\\b(verb)\\s+(${NAME})\\s*(\\{)`,
    end: '\\}',
    beginCaptures: named(
      KEYWORD,
      `entity.name.function.verb.${S}`,
      `punctuation.section.block.begin.${S}`,
    ),
    endCaptures: { '0': { name: `punctuation.section.block.end.${S}` } },
    patterns: [
      ...COMMENTS,
      quoted(`string.quoted.double.phrase.${S}`, [...ESCAPES, ROLE_SLOT]),
      { include: '$self' },
    ],
  },
  {
    match: `\\b(verb)\\s+(${NAME})`,
    captures: named(KEYWORD, `entity.name.function.verb.${S}`),
  },
  {
    match: `\\b(as)\\s+(${NAME})\\s+(for)\\s+(${NAME})`,
    captures: named(
      KEYWORD,
      `variable.parameter.role.${S}`,
      KEYWORD,
      `entity.name.function.verb.${S}`,
    ),
  },
  {
    match: `\\b(role)\\s+(${NAME})`,
    captures: named(KEYWORD, `variable.parameter.role.${S}`),
  },
  {
    match: `\\b(exit|link|connect)\\s+(${NAME})`,
    captures: named(KEYWORD, `entity.name.label.${S}`),
  },
];

/** `say`, `tell`, `text` and `refuse` with quoted text, which is a one-line passage. */
const SPEECH: Rule = {
  begin: `\\b(say|tell|text|refuse)\\b(?:\\s+(${NAME}(?:\\.${NAME})*))?\\s*(?=")`,
  end: '(?<=")|$',
  beginCaptures: {
    '1': { name: KEYWORD },
    '2': { patterns: [{ include: '#words' }] },
  },
  patterns: [
    {
      name: `string.quoted.double.${S}`,
      contentName: `meta.embedded.line.sprout-prose`,
      begin: '"',
      end: '"|$',
      beginCaptures: { '0': { name: `punctuation.definition.string.begin.${S}` } },
      endCaptures: { '0': { name: `punctuation.definition.string.end.${S}` } },
      patterns: [{ include: `${PROSE}#inline` }],
    },
  ],
};

/** Keywords, names and punctuation: everything that is not a declaration's head or text. */
const WORDS: readonly Rule[] = [
  { name: `constant.language.boolean.${S}`, match: wordsPattern(LITERALS) },
  { name: `storage.type.${S}`, match: wordsPattern(TYPE_NAMES) },
  { name: KEYWORD, match: wordsPattern(syntaxWords()) },
  { name: KEYWORD, match: '\\bis\\b(?!\\s*\\()' },
  { name: `variable.language.${S}`, match: '\\b(?:self|actor|here)\\b' },
  {
    match: `\\b(${NAME})(\\.)(${TYPE})\\b`,
    captures: named(
      `entity.name.namespace.${S}`,
      `punctuation.accessor.${S}`,
      `entity.name.type.${S}`,
    ),
  },
  {
    match: `\\b(${TYPE})(\\.)(${NAME})\\b`,
    captures: named(
      `entity.name.type.${S}`,
      `punctuation.accessor.${S}`,
      `variable.other.enummember.${S}`,
    ),
  },
  {
    match: '(:)([a-z][a-z0-9_]*)',
    name: `constant.other.symbol.${S}`,
    captures: named(`punctuation.definition.symbol.${S}`),
  },
  { name: `constant.numeric.integer.${S}`, match: '\\b[0-9]+\\b' },
  // A capital ends a lower-case word, as the lexer reads `visitsCount` as `visits` and `Count`.
  { name: `entity.name.type.${S}`, match: `(?:\\b|(?<=[a-z0-9_]))${TYPE}\\b` },
  { name: `entity.name.function.${S}`, match: `\\b${NAME}(?=\\s*\\()` },
  { name: `variable.other.${S}`, match: `\\b${NAME}` },
  { name: `keyword.operator.arrow.${S}`, match: '->' },
  { name: `keyword.operator.${S}`, match: '==|!=|<=|>=|&&|\\|\\||[<>!=+\\-*/]' },
  { name: `punctuation.section.block.begin.${S}`, match: '\\{' },
  { name: `punctuation.section.block.end.${S}`, match: '\\}' },
  { name: `punctuation.section.brackets.${S}`, match: '[\\[\\]]' },
  { name: `punctuation.section.parens.${S}`, match: '[()]' },
  { name: `punctuation.separator.${S}`, match: ',' },
  { name: `punctuation.accessor.${S}`, match: '\\.' },
  { name: `punctuation.separator.label.${S}`, match: ':' },
];

/** The `.sprout` grammar. */
export function sproutGrammar(): Grammar {
  return {
    $schema: SCHEMA,
    name: 'Sprout',
    scopeName: `source.${S}`,
    fileTypes: ['sprout'],
    patterns: [
      ...COMMENTS,
      { include: `${PROSE}#passage` },
      { include: '#declarations' },
      SPEECH,
      quoted(`string.quoted.double.${S}`, ESCAPES),
      { include: '#words' },
    ],
    repository: {
      declarations: { patterns: DECLARATIONS },
      words: { patterns: WORDS },
    },
  };
}
