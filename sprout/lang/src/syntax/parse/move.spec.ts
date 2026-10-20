import { describe, expect, it } from 'vitest';

import type { MoveStatement, MoveThroughStatement } from '../ast.js';
import { writtenPath } from '../ast.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { readWith as over } from '../../fixtures/readers.js';
import type { Parser } from './parser.js';
import { moveStatement } from './move.js';
import { block, notAStatement, onItsOwn, statement } from './statements.js';

/** One reader, run over a string on its own. */
const readWith = <T>(read: (p: Parser) => T, text: string) =>
  over(read, text, { name: 'body.sprout' });

/** One statement, read outside any body; anything after it is refused as the next statement would be. */
function readStatement(text: string) {
  const { read, refusals } = readWith((p) => {
    const one = statement(p);
    if (one !== null && !p.done) notAStatement(p, p.peek());
    return one;
  }, text);
  return { statement: read, refusals };
}

/** A move's two sides as written. */
function moveShape(move: MoveStatement): string {
  return `move ${writtenPath(move.thing)} to ${writtenPath(move.destination)}`;
}
describe('`move` proposes moving a thing into a container', () => {
  it('reads the spec’s own, and the forms a body names things by', () => {
    for (const text of [
      'move target to self',
      'move item to cellar',
      'move actor to here',
      'move self to from',
      'move kiln.cup to kiln.shelf',
    ]) {
      const { statement, refusals } = readStatement(text);
      expect(
        refusals.map((d) => d.message),
        text,
      ).toEqual([]);
      expect(statement!.kind, text).toBe('move');
      expect(moveShape(statement as MoveStatement), text).toBe(text);
      expect(textOf(statement!.at), text).toBe(text);
      expect(unspanned(statement), text).toEqual([]);
    }
  });

  it('keeps each step of either side, each with its own span', () => {
    const { read } = readWith(moveStatement, 'move kiln.cup to  shop.shelf');
    expect(read!.thing.parts.map((part) => locationOf(part.at))).toEqual([
      'body.sprout:1:6',
      'body.sprout:1:11',
    ]);
    if (read?.kind !== 'move') return expect.unreachable('a `move` with `to` was written');
    expect(textOf(read.destination.at)).toBe('shop.shelf');
  });

  it('says what is missing, where it is missing, and what to write', () => {
    const table: [string, string, string, string][] = [
      [
        'move',
        'body.sprout:1:5',
        '`move` does not say what to move.',
        'Write the thing and where it goes, as in `move target to self`.',
      ],
      [
        'move to self',
        'body.sprout:1:5',
        '`move` does not say what to move.',
        'Write the thing and where it goes, as in `move target to self`.',
      ],
      [
        'move 3 to self',
        'body.sprout:1:6',
        '`move` does not say what to move.',
        'Write the thing and where it goes, as in `move target to self`.',
      ],
      [
        'move Cup to self',
        'body.sprout:1:6',
        '`Cup` starts with a capital, so it is not the name of anything here.',
        'Name what moves in lower case, as in `move target to self`.',
      ],
      [
        'move target',
        'body.sprout:1:12',
        '`move target` does not say where it goes.',
        'Write `to` and what it goes into: `move target to self`.',
      ],
      [
        'move kiln.cup in self',
        'body.sprout:1:14',
        '`move kiln.cup` does not say where it goes.',
        'Write `to` and what it goes into: `move kiln.cup to self`.',
      ],
      [
        'move self',
        'body.sprout:1:10',
        '`move self` does not say where it goes.',
        'Write `to` and what it goes into, `move self to actor`, or the way it goes, `move self north`.',
      ],
      [
        'move self to',
        'body.sprout:1:13',
        'After `to` comes the thing `self` goes into.',
        'Name it in lower case, as in `move self to actor` or `move self to here`.',
      ],
      [
        'move actor to',
        'body.sprout:1:14',
        'After `to` comes the thing `actor` goes into.',
        'Name it in lower case, as in `move actor to self` or `move actor to here`.',
      ],
      [
        'move target to',
        'body.sprout:1:15',
        'After `to` comes the thing `target` goes into.',
        'Name it in lower case, as in `move target to self` or `move target to actor`.',
      ],
      [
        'move target to Shelf',
        'body.sprout:1:16',
        'After `to` comes the thing `target` goes into.',
        'Name it in lower case, as in `move target to self` or `move target to actor`.',
      ],
      [
        'move target to kiln.',
        'body.sprout:1:20',
        'This path ends in a dot.',
        'After a dot comes the name of what is inside the thing before it, as in `kiln.shelf`; or take the dot out.',
      ],
    ];
    for (const [text, where, message, remedy] of table) {
      const { statement, refusals } = readStatement(text);
      expect(statement, text).toBeNull();
      expect(
        refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
        text,
      ).toEqual([[where, message, remedy]]);
    }
  });

  it('never takes the statement after an unfinished one for either side', () => {
    for (const text of ['{ move\n say "x" }', '{ move target to\n say "x" }']) {
      const { read, refusals } = readWith((p) => block(p, onItsOwn()), text);
      expect(refusals, text).toHaveLength(1);
      expect(
        read!.statements.map((one) => one.kind),
        text,
      ).toEqual(['say']);
    }
  });
});

/** A way out as written. */
function throughShape(move: MoveThroughStatement): string {
  return `move ${writtenPath(move.thing)} ${move.direction?.text ?? 'along an exit'}`;
}

describe('`move` through a way out', () => {
  it('reads a direction, and a way drawn, each spanning the whole statement', () => {
    for (const text of [
      'move self north',
      'move self in',
      'move self along an exit',
      'move target up',
    ]) {
      const { statement, refusals } = readStatement(text);
      expect(
        refusals.map((d) => d.message),
        text,
      ).toEqual([]);
      expect(statement!.kind, text).toBe('move-through');
      expect(throughShape(statement as MoveThroughStatement), text).toBe(text);
      expect(textOf(statement!.at), text).toBe(text);
      expect(unspanned(statement), text).toEqual([]);
    }
    const drawn = readStatement('move self along an exit').statement as MoveThroughStatement;
    expect(drawn.direction).toBeNull();
  });

  it('keeps the direction’s own span, for the checker to point at', () => {
    const { read } = readWith(moveStatement, 'move self  north');
    if (read?.kind !== 'move-through') return expect.unreachable('a way out was written');
    expect(locationOf(read.direction!.at)).toBe('body.sprout:1:12');
  });

  it('reads a word as a direction only where the statement ends after it', () => {
    const { refusals } = readStatement('move kiln.cup in self');
    expect(refusals.map((d) => d.message)).toEqual(['`move kiln.cup` does not say where it goes.']);
    const split = readWith((p) => block(p, onItsOwn()), '{ move self\n north }');
    expect(split.refusals.map((d) => d.message)).toContain(
      '`move self` does not say where it goes.',
    );
  });

  it('takes a direction of the closed set, written out, and says what to write for any other word', () => {
    const said = (text: string) =>
      readStatement(text).refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);
    expect(said('move self n')).toEqual([
      [
        'body.sprout:1:11',
        '`n` is what a visitor may type for `north`, and a body writes the direction out.',
        'Write `move self north`.',
      ],
    ]);
    expect(said('move self cellar')).toEqual([
      [
        'body.sprout:1:11',
        '`cellar` is not a direction, so `move self cellar` names no way out.',
        'Write `to` before what it goes into, `move self to cellar`, or a direction: `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `up`, `down`, `in` and `out`.',
      ],
    ]);
  });

  it('says what `along` wants after it', () => {
    for (const text of ['move self along', 'move self along exit', 'move self along an']) {
      expect(
        readStatement(text).refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
        text,
      ).toEqual([
        [
          'body.sprout:1:16',
          '`along` is followed by `an exit`: the way is drawn from those that lead out.',
          'Write `move self along an exit`, or name a direction, as in `move self north`.',
        ],
      ]);
    }
  });

  it('never takes the statement after it for its direction', () => {
    for (const text of [
      '{ move self north\n say "x" }',
      '{ move self along an exit\n say "x" }',
      '{ move self north }',
      '{ move self\n say "x" }',
    ]) {
      const { read } = readWith((p) => block(p, onItsOwn()), text);
      expect(read!.statements.map((one) => one.kind).at(-1), text).toBe(
        text.includes('say') ? 'say' : 'move-through',
      );
    }
  });
});
