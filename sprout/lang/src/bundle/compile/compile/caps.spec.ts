// `compileBundle`'s wiring of `countWorld` (`bundle/counts.ts`) over the
// kinds, objects and places a world resolves to: a library's kinds count
// among the world's own, a blessed library's do not, and every cap
// refuses at the same place in either mode.

import { describe, expect, it } from 'vitest';

import { libraryHash, type LibrarySource } from '../../bundle.js';
import { compileBundle } from '../compile.js';
import { limitsFrom } from '../../limits.js';
import { STANDARD_LIBRARY } from '../../standard-library.js';
import { locationOf } from '../../../source/source.js';
import { file, refusals, VISITOR, world } from '../../../fixtures/compile.js';

describe('kinds, objects and places are counted against the host’s caps', () => {
  // Two kinds and two objects of the world's own, one of them a place,
  // and a copy of the standard library with a fourth kind added to its three.
  const OWN = `world printers_shop: sprout.World { visitors are Visitor visitors arrive at hall }
${VISITOR}
kind Room { contains actors }
kind Crate { contains }
object hall: Room in printers_shop
object box: Crate in hall
`;
  const KINDED: LibrarySource = {
    ...STANDARD_LIBRARY,
    files: [...STANDARD_LIBRARY.files, file('kinds.sprout', 'kind Container { contains }')],
  };
  const kinded = () =>
    world({
      files: [file('world.sprout', OWN)],
      libraries: [KINDED],
      manifest: {
        libraries: [{ name: 'sprout', version: '0.1.0', sha: libraryHash(KINDED) }],
      },
    });
  const blessed = new Set([libraryHash(KINDED)]);

  it('records how many of each the world has, a library’s kinds among its own', () => {
    const { bundle, diagnostics } = compileBundle(kinded());
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.size).toMatchObject({ kinds: 7, objects: 2, places: 1 });
  });

  it('leaves a blessed library’s kinds out, as it leaves out its bytes and files', () => {
    const { bundle } = compileBundle(kinded(), { blessed });
    expect(bundle!.size).toMatchObject({ kinds: 3, objects: 2, places: 1 });
  });

  it('refuses a kind past the cap at the kind, a library’s included', () => {
    const limits = limitsFrom({ caps: { kinds: 6 } });
    const { bundle, diagnostics } = compileBundle(kinded(), { limits });
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'kinds.sprout:1:6',
        'This world declares 7 kinds, and 6 is as many as it may have.',
        'Take some out, or use a library the host has blessed, whose kinds cost nothing.',
      ],
    ]);
    expect(compileBundle(kinded(), { limits, blessed }).bundle).not.toBeNull();
  });

  it('refuses an object and a place past the cap, at the object', () => {
    const limits = limitsFrom({ caps: { objects: 1, places: 1 } });
    expect(
      refusals(compileBundle(kinded(), { limits }).diagnostics).map((d) => [
        locationOf(d.at),
        d.message,
      ]),
    ).toEqual([
      ['world.sprout:6:8', 'This world declares 2 objects, and 1 is as many as it may have.'],
    ]);
    const places = `${OWN}object press_room: Room in printers_shop\n`;
    const { diagnostics } = compileBundle(world({ files: [file('world.sprout', places)] }), {
      limits: limitsFrom({ caps: { places: 1 } }),
    });
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message])).toEqual([
      ['world.sprout:7:8', 'This world has 2 places, and 1 is as many as it may have.'],
    ]);
  });

  it('refuses at load as at publish, since no exception is recorded for it', () => {
    const limits = limitsFrom({ caps: { kinds: 1 } });
    const { bundle, diagnostics } = compileBundle(kinded(), { mode: 'load', limits });
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toBe(
      'This world declares 7 kinds, and 1 is as many as it may have.',
    );
  });

  it('bounds none of them where the host set nothing', () => {
    const many = Array.from({ length: 40 }, (_, i) => `object o${i}: Room in printers_shop`);
    const files = [file('world.sprout', `${OWN}${many.join('\n')}\n`)];
    const { bundle } = compileBundle(world({ files }));
    expect(bundle!.size).toMatchObject({ objects: 42, places: 41 });
  });
});
