// The TextMate grammar for `.prose` files, and the prose rules the
// `.sprout` grammar borrows for inline passages and quoted speech (the
// spec's Prose › Passages, Slots, Conditionals and loops; The compiler ›
// Lexical rules). A passage body runs to the `}` that matches its `{`, as
// the lexer reads it: every tag nests, `\{` is a character, and `//` in a
// body is words. Inside quoted text a tag also ends at the closing quote,
// since quoted text ends there whatever it holds.

import { LITERALS } from './keywords.ts';
import { type Grammar, type Rule, SCHEMA, named } from './rule.ts';

const S = 'sprout-prose';

/** The comments a `.prose` file may hold between its passages. */
export const COMMENTS: readonly Rule[] = [
  {
    name: `comment.block.${S}`,
    begin: '/\\*',
    end: '\\*/',
    beginCaptures: named(`punctuation.definition.comment.begin.${S}`),
    endCaptures: named(`punctuation.definition.comment.end.${S}`),
  },
  {
    name: `comment.line.double-slash.${S}`,
    begin: '//',
    end: '$',
    beginCaptures: { '0': { name: `punctuation.definition.comment.${S}` } },
  },
];

/** The four escapes, and a backslash before anything else stepped over with its character. */
const ESCAPES: readonly Rule[] = [
  { name: `constant.character.escape.${S}`, match: '\\\\["\\\\n{]' },
  { match: '\\\\.' },
];

/** What a slot or a condition says: an expression, as the language writes one. */
function expression(inline: boolean): Rule[] {
  const rules: Rule[] = [
    { name: `variable.language.loop.${S}`, match: '\\$(?:first|last|index|count)\\b' },
    { name: `variable.language.${S}`, match: '\\b(?:self|actor|here)\\b' },
    { name: `constant.language.boolean.${S}`, match: `\\b(?:${LITERALS.join('|')})\\b` },
    {
      match: '(:)([a-z][a-z0-9_]*)',
      name: `constant.other.symbol.${S}`,
      captures: named(`punctuation.definition.symbol.${S}`),
    },
    { name: `constant.numeric.integer.${S}`, match: '\\b[0-9]+\\b' },
    {
      match: '\\b([a-z_][a-z0-9_]*)(\\.)(?=[A-Z])',
      captures: named(`entity.name.namespace.${S}`, `punctuation.accessor.${S}`),
    },
    { name: `entity.name.type.${S}`, match: '(?:\\b|(?<=[a-z0-9_]))[A-Z][A-Za-z0-9_]*\\b' },
    { name: `entity.name.function.${S}`, match: '\\b[a-z_][a-z0-9_]*(?=\\s*\\()' },
    { name: `variable.other.${S}`, match: '\\b[a-z_][a-z0-9_]*' },
    { name: `keyword.operator.${S}`, match: '==|!=|<=|>=|&&|\\|\\||[<>!+\\-*/]' },
    { name: `punctuation.accessor.${S}`, match: '\\.' },
    { name: `punctuation.separator.${S}`, match: ',' },
    { name: `punctuation.section.parens.${S}`, match: '[()]' },
    { name: `punctuation.separator.label.${S}`, match: ':' },
  ];
  if (inline) return rules;
  // Quoted text in a slot of a passage is text, and ends at its quote or its line.
  const text: Rule = {
    name: `string.quoted.double.${S}`,
    begin: '"',
    end: '"|$',
    beginCaptures: { '0': { name: `punctuation.definition.string.begin.${S}` } },
    endCaptures: { '0': { name: `punctuation.definition.string.end.${S}` } },
    patterns: ESCAPES,
  };
  return [text, ...rules];
}

const OPEN = `punctuation.definition.tag.begin.${S}`;
const CLOSE = `punctuation.definition.tag.end.${S}`;
const TAG = `meta.tag.${S}`;
const CONDITIONAL = `keyword.control.conditional.${S}`;
const LOOP = `keyword.control.loop.${S}`;
const CHOICE = `keyword.control.choice.${S}`;

/** Every tag: the closes, the bare words, `{if …}` and `{for …}`, and a slot. */
function tags(inline: boolean): Rule[] {
  const end = inline ? '\\}|(?=")' : '\\}';
  const body = expression(inline);
  const bare = (words: string, name: string): Rule => ({
    name: TAG,
    match: `(\\{)\\s*(${words})\\s*(\\})`,
    captures: named(OPEN, name, CLOSE),
  });
  const close = (words: string, name: string): Rule => ({
    name: TAG,
    match: `(\\{)\\s*(/)\\s*(${words})\\s*(\\})`,
    captures: named(OPEN, name, name, CLOSE),
  });
  const opened = (words: string, name: string, extra: Rule[]): Rule => ({
    name: TAG,
    begin: `(\\{)\\s*(${words})\\b`,
    end,
    beginCaptures: named(OPEN, name),
    endCaptures: { '0': { name: CLOSE } },
    patterns: [...extra, ...body],
  });
  return [
    close('if', CONDITIONAL),
    close('for', LOOP),
    close('one\\s+of', CHOICE),
    bare('one\\s+of', CHOICE),
    bare('or', CHOICE),
    bare('else', CONDITIONAL),
    opened('else\\s+if|if', CONDITIONAL, []),
    opened('for', LOOP, [{ name: LOOP, match: '\\b(?:in|of)\\b' }]),
    {
      name: `meta.slot.${S}`,
      begin: '\\{',
      end,
      beginCaptures: { '0': { name: OPEN } },
      endCaptures: { '0': { name: CLOSE } },
      patterns: body,
    },
  ];
}

/** `passage name { … }`, or `passage name default { … }`, its body read as prose. */
export const PASSAGE: Rule = {
  name: `meta.passage.${S}`,
  begin: '\\b(passage)\\s+([a-z_][a-z0-9_]*)(?:\\s+(default))?\\s*(\\{)',
  end: '\\}',
  beginCaptures: named(
    `keyword.other.${S}`,
    `entity.name.function.passage.${S}`,
    `keyword.other.${S}`,
    `punctuation.section.passage.begin.${S}`,
  ),
  endCaptures: { '0': { name: `punctuation.section.passage.end.${S}` } },
  contentName: `meta.embedded.block.${S}`,
  patterns: [{ include: '#body' }],
};

/** The prose grammar: `.prose` files, and the rules the `.sprout` grammar includes by name. */
export function proseGrammar(): Grammar {
  return {
    $schema: SCHEMA,
    name: 'Sprout prose',
    scopeName: `source.${S}`,
    fileTypes: ['prose'],
    patterns: [...COMMENTS, { include: '#passage' }],
    repository: {
      passage: PASSAGE,
      // A passage's body.
      body: { patterns: [...ESCAPES, ...tags(false)] },
      // Quoted text given to `say`, `tell`, `text` or `refuse`: a one-line passage.
      inline: { patterns: [...ESCAPES, ...tags(true)] },
    },
  };
}
