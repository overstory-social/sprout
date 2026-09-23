// `arrivalOf`: the path written after `visitors arrive at`, kept with
// its span for `resolveArrival` to walk, and refused once — at the
// world's name when nothing is written, at the second when it is
// written twice.

import { describe, expect, it } from 'vitest';

import { writtenPath, type WorldDeclaration } from '../../syntax/ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { SourceFile, textOf } from '../../source/source.js';
import { arrivalOf } from '../world.js';
import { SHOP } from '../../fixtures/world.js';

describe('`arrivalOf` reads where visitors arrive, and says once what is wrong with it', () => {
  /** The world declaration in `text`, which must parse. */
  function declared(text: string): WorldDeclaration {
    const parsing = new Diagnostics();
    const found = parseDeclarations(new SourceFile('w.sprout', text), parsing).find(
      (d): d is WorldDeclaration => d.kind === 'world',
    );
    expect(parsing.refusals.map((d) => d.message)).toEqual([]);
    return found!;
  }

  it('keeps the path written, with its span', () => {
    const diagnostics = new Diagnostics();
    const path = arrivalOf(declared(SHOP), diagnostics);
    expect(diagnostics.all).toEqual([]);
    expect(path!.kind).toBe('path');
    expect(textOf(path!.at)).toBe('composing_room');
    const deeper = arrivalOf(
      declared('world w is sprout.World {\n  visitors arrive at house.bedroom.wardrobe\n}'),
      diagnostics,
    );
    expect(writtenPath(deeper!)).toBe('house.bedroom.wardrobe');
  });

  it('refuses a world that says nothing about it, at the world’s name', () => {
    const diagnostics = new Diagnostics();
    expect(
      arrivalOf(declared('world w is sprout.World { visitors are P }'), diagnostics),
    ).toBeNull();
    expect(diagnostics.refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        '`w` does not say where a visitor arrives.',
        'Write `visitors arrive at <name>`, naming the place they begin in.',
      ],
    ]);
    expect(textOf(diagnostics.refusals[0]!.at)).toBe('w');
  });

  it('refuses saying it twice at the second, and keeps the first', () => {
    const diagnostics = new Diagnostics();
    const path = arrivalOf(
      declared(
        'world w is sprout.World {\n  visitors arrive at first\n  visitors arrive at second\n}',
      ),
      diagnostics,
    );
    expect(writtenPath(path!)).toBe('first');
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      '`w` says twice where its visitors arrive.',
    ]);
    expect(textOf(diagnostics.refusals[0]!.at)).toBe('visitors arrive at second');
  });
});
