// `move`, read (the spec's Verbs › Moving something): what moves, then
// either `to` and what it goes into, `move target to self`, or the way out
// it goes through, a direction, `move self north`, or one drawn,
// `move self along an exit`. A direction is one of the closed set, written
// out; which things may go through a way is the checker's.
//
// A refused one costs only itself: a word the next statement or the body's
// next member starts with is never taken for either side, and a word is
// read as a way out only where the statement ends after it, so
// `move cup in self` is a `move` missing its `to` rather than a way out
// followed by a stray.

import type { MoveStatement, MoveThroughStatement, ObjectPath } from '../ast.js';
import { writtenPath } from '../ast.js';
import { ABBREVIATIONS, DIRECTIONS } from '../directions.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { readable } from '../../source/words.js';
import { punct, type Parser } from './parser.js';
import { objectPath } from './paths.js';
import { notAStatement, onItsOwn, startsNext, type Enclosing } from './statements.js';

/**
 * `move target to self`, `move self north` or `move self along an exit`.
 * Null having said why.
 */
export function moveStatement(
  p: Parser,
  within: Enclosing = onItsOwn(),
): MoveStatement | MoveThroughStatement | null {
  const keyword = p.take('name', 'move');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const thing = movePart(p, within, keyword.at, (at, wrote) => {
    if (wrote?.kind === 'kind') {
      p.diagnostics.refuse(
        at,
        `\`${wrote.text}\` starts with a capital, so it is not the name of anything here.`,
        'Name what moves in lower case, as in `move target to self`.',
      );
      return;
    }
    p.diagnostics.refuse(
      at,
      '`move` does not say what to move.',
      'Write the thing and where it goes, as in `move target to self`.',
    );
  });
  if (thing === null) return null;
  const moved = writtenPath(thing);
  const into = moved === 'self' || moved === 'actor' ? INTO[moved] : INTO.other;

  const along = p.peek();
  if (along.kind === 'name' && along.text === 'along') return drawn(p, keyword.at, thing);
  if (endsAfter(p, within, thing.at, along)) return through(p, keyword.at, thing);

  const to = p.take('name', 'to');
  if (to === null) {
    p.diagnostics.refuse(
      p.source.span(thing.at.end),
      `\`move ${moved}\` does not say where it goes.`,
      moved === 'self'
        ? 'Write `to` and what it goes into, `move self to actor`, or the way it goes, `move self north`.'
        : `Write \`to\` and what it goes into: \`move ${moved} to ${into[0]}\`.`,
    );
    return null;
  }

  const destination = movePart(p, within, to.at, (at) => {
    p.diagnostics.refuse(
      at,
      `After \`to\` comes the thing \`${moved}\` goes into.`,
      `Name it in lower case, as in \`move ${moved} to ${into[0]}\` or \`move ${moved} to ${into[1]}\`.`,
    );
  });
  if (destination === null) return null;
  return { kind: 'move', at: spanning(keyword.at, destination.at), thing, destination };
}

/** The direction after what moves, which ends the statement. Null having said why. */
function through(p: Parser, keyword: Span, thing: ObjectPath): MoveThroughStatement | null {
  const word = p.next();
  const moved = writtenPath(thing);
  if ((DIRECTIONS as readonly string[]).includes(word.text)) {
    const direction = { kind: 'ident', at: word.at, text: word.text } as const;
    return { kind: 'move-through', at: spanning(keyword, word.at), thing, direction };
  }
  const short = ABBREVIATIONS.get(word.text);
  if (short !== undefined) {
    p.diagnostics.refuse(
      word.at,
      `\`${word.text}\` is what a visitor may type for \`${short}\`, and a body writes the direction out.`,
      `Write \`move ${moved} ${short}\`.`,
    );
    return null;
  }
  p.diagnostics.refuse(
    word.at,
    `\`${word.text}\` is not a direction, so \`move ${moved} ${word.text}\` names no way out.`,
    `Write \`to\` before what it goes into, \`move ${moved} to ${word.text}\`, or a direction: ${readable([...DIRECTIONS])}.`,
  );
  return null;
}

/** `along an exit`, after what moves: the way drawn. Null having said why. */
function drawn(p: Parser, keyword: Span, thing: ObjectPath): MoveThroughStatement | null {
  const along = p.next();
  const an = p.peek();
  const exit = p.peek(1);
  const written = (token: Token, text: string) => token.kind === 'name' && token.text === text;
  if (!written(an, 'an') || !written(exit, 'exit')) {
    p.diagnostics.refuse(
      p.source.span(along.at.end),
      '`along` is followed by `an exit`: the way is drawn from those that lead out.',
      `Write \`move ${writtenPath(thing)} along an exit\`, or name a direction, as in \`move ${writtenPath(thing)} north\`.`,
    );
    return null;
  }
  p.next();
  p.next();
  return { kind: 'move-through', at: spanning(keyword, exit.at), thing, direction: null };
}

/**
 * Whether `token` is a lower-case word the statement ends after: on the
 * line of what moves, and followed by the next statement, a new line, the
 * block's `}` or the end.
 */
function endsAfter(p: Parser, within: Enclosing, thing: Span, token: Token): boolean {
  if (token.kind !== 'name' || token.text === 'to' || startsNext(p, within, token)) return false;
  const after = p.peek(1);
  const lineOf = (at: Span) => p.source.text.lastIndexOf('\n', at.start - 1);
  if (lineOf(token.at) !== lineOf(thing)) return false;
  return (
    after.kind === 'end' ||
    punct(after, '}') ||
    lineOf(after.at) !== lineOf(token.at) ||
    ((after.kind === 'name' || after.kind === 'symbol') && startsNext(p, within, after))
  );
}

/** Where a `move` remedy's examples send a thing, by what it is, so that nothing goes into itself. */
const INTO = {
  self: ['actor', 'here'],
  actor: ['self', 'here'],
  other: ['self', 'actor'],
} as const;

/**
 * One side of a `move`: a path, or null having said why through `missing`,
 * which is given the token written in its place, taken with the refusal,
 * or null where nothing is there or a word starts what comes next.
 */
function movePart(
  p: Parser,
  within: Enclosing,
  after: Span,
  missing: (at: Span, wrote: Token | null) => void,
): ObjectPath | null {
  const head = p.peek();
  const ahead = head.kind === 'name' && (startsNext(p, within, head) || head.text === 'to');
  if (head.kind === 'name' && !ahead && !p.atDeclarationStart()) {
    p.next();
    return objectPath(p, head);
  }
  const gap =
    ahead ||
    head.kind === 'end' ||
    punct(head, '}') ||
    p.atDeclarationStart() ||
    (head.kind === 'symbol' && startsNext(p, within, head));
  if (gap) {
    missing(p.source.span(after.end), null);
    return null;
  }
  if (head.kind !== 'punct') p.next();
  missing(head.at, head);
  return null;
}
