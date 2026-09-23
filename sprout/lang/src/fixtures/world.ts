// The printer's shop `declare/world.spec.ts` and `declare/world/*.spec.ts`
// type against: an enum, three libraries' worth of kinds — the world's
// own, the standard library's and a second library's, `victorian` —
// and `world()`, which reads a world declaration and composes it. A
// fixture that does not parse or compose throws with what was said,
// since a fixture that does not compile proves nothing. Spec support:
// the package build leaves it out.

import type { KindDeclaration, WorldDeclaration } from '../syntax/ast.js';
import { composeWorld, resolveVisitors } from '../declare/world.js';
import { KindTable } from '../declare/kinds.js';
import type { KindSource } from '../declare/compose.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';

/** A fixture that could not be built is the fixture's fault, not the case's. */
function settled(diagnostics: Diagnostics, what: string): void {
  if (diagnostics.refusals.length > 0) {
    throw new Error(`${what}: ${diagnostics.refusals.map((d) => d.message).join(' ')}`);
  }
}

export const ENUMS = (() => {
  const table = new EnumTable();
  const diagnostics = new Diagnostics();
  table.add(
    'printers_shop',
    parseDeclarations(
      new SourceFile('e.sprout', 'enum Season { autumn, winter }\n'),
      diagnostics,
    ).filter((d) => d.kind === 'enum'),
    diagnostics,
  );
  settled(diagnostics, 'the enums');
  return table;
})();

/** The kinds a world here may compose, by library, which must compose cleanly. */
export const LIBRARIES: Readonly<Record<string, string>> = {
  sprout: 'kind World { }\nkind Actor { }\nkind Container { :open true }',
  printers_shop: 'kind Creature: sprout.Actor { }\nkind Hall { contains actors }',
  victorian: 'kind Voice { :formal true }\nkind Lamp { :open true }\nkind Gent: sprout.Actor { }',
};

/** Every kind in `libraries`, composed. */
export function kindsOf(libraries: Readonly<Record<string, string>> = LIBRARIES): KindSource {
  const diagnostics = new Diagnostics();
  const kinds = new KindTable();
  for (const [library, text] of Object.entries(libraries)) {
    kinds.add(
      library,
      parseDeclarations(new SourceFile(`${library}.sprout`, text), diagnostics).filter(
        (d): d is KindDeclaration => d.kind === 'kind',
      ),
      diagnostics,
    );
  }
  kinds.resolve('printers_shop', ENUMS, diagnostics);
  settled(diagnostics, 'the kinds');
  return kinds;
}
export const KINDS = kindsOf();

/**
 * Read a world, compose it and read what its visitors are made of. The
 * parse must succeed.
 */
export function world(text: string, kinds: KindSource = KINDS) {
  const parsing = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('w.sprout', text), parsing).find(
    (d): d is WorldDeclaration => d.kind === 'world',
  );
  settled(parsing, `\`${text}\` did not parse`);
  const diagnostics = new Diagnostics();
  const context = { enums: ENUMS, kinds, from: 'printers_shop', diagnostics };
  const kind = composeWorld(declared!, context);
  const visitors = resolveVisitors(declared!, context);
  return {
    kind,
    visitors,
    visitor: visitors.found === 'kind' ? visitors.kind : null,
    said: diagnostics.refusals.map((d) => d.message),
    diagnostics,
    declared: declared!,
  };
}

export const SHOP = `world printers_shop: sprout.World {
  visitors are Creature
  visitors arrive at composing_room
  :season Season default autumn
}`;
