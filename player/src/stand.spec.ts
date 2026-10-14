import { declaredId, mintedId, type InstanceId } from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { catalogueFor } from './engine.js';
import { INSPECTOR, pathOf, standIn } from './stand.js';
import { ENGINES_BUILT } from './fixtures/play.js';
import { bundleOf, LANE } from './fixtures/worlds.js';

const lane = () => bundleOf('lane', LANE);
const id = (...path: string[]): InstanceId => declaredId('lane', path);

describe.each(ENGINES_BUILT)('standIn, on the %s engine', (engine) => {
  it('admits one visitor where visitors arrive, by an arrival turn, named Inspector', () => {
    const standing = standIn(lane(), engine);
    expect(standing.place).toBe(id('yard'));
    const instance = standing.stored.instances.find((one) => one.id === standing.actor);
    expect(instance!.container).toBe(id('yard'));
    const record = standing.stored.visitors.find((one) => one.visit === standing.visit)!;
    expect(record).toMatchObject({ nickname: INSPECTOR, instance: standing.actor });
    expect(record.lastPlace).toBe(id('yard'));
  });

  it('stands them in another place, asked as a returning visitor’s last place is', () => {
    const standing = standIn(lane(), engine, { at: 'shed', nickname: 'Marta' });
    expect(standing.place).toBe(id('shed'));
    expect(standing.stored.visitors.find((one) => one.visit === standing.visit)!.nickname).toBe(
      'Marta',
    );
  });

  it('refuses a place its `accept` keeps them out of, naming where they came in instead', () => {
    expect(() => standIn(lane(), engine, { at: 'attic' })).toThrow(
      '`attic` does not let a visitor in, so they came in at `yard`: its `accept`, or a bound on how many may stand there, turned them away.',
    );
  });

  it('refuses what is not a place, listing the places to write instead', () => {
    const message =
      "is not a place in lane, so nobody can stand there. After --at, write one of its places as the world's body names it: yard, shed, attic.";
    expect(() => standIn(lane(), engine, { at: 'yard.crate' })).toThrow(
      `\`yard.crate\` ${message}`,
    );
    expect(() => standIn(lane(), engine, { at: 'loft' })).toThrow(`\`loft\` ${message}`);
  });

  it('refuses a nickname the world reads as a word, and says to give another', () => {
    expect(() => standIn(lane(), engine, { nickname: 'crate' })).toThrow(
      '"crate" is a word this world already reads, so "crate" would not always mean you: choose another nickname. Give one with --as.',
    );
  });

  it('refuses a nickname the language reserves, one shaped like source, or one past the default length, as a host would', () => {
    expect(() => standIn(lane(), engine, { nickname: 'Marta When' })).toThrow(
      '"when" is a word every world here reads, so "Marta When" would not always mean you: choose another nickname. Give one with --as.',
    );
    expect(() => standIn(lane(), engine, { nickname: ':marta' })).toThrow(
      'A nickname\'s word may not begin with a colon, and ":marta" does: choose another nickname. Give one with --as.',
    );
    expect(() => standIn(lane(), engine, { nickname: 'marta.b' })).toThrow(
      'A nickname\'s word may not have a period inside it, and "marta.b" does: choose another nickname. Give one with --as.',
    );
    expect(() => standIn(lane(), engine, { nickname: 'Marta the Twenty-Fifth Inspector' })).toThrow(
      '"Marta the Twenty-Fifth Inspector" is 32 characters, and a nickname here may have at most 24: choose a shorter one. Give one with --as.',
    );
  });
});

describe('pathOf', () => {
  it('writes a declared id as its path under the world, and the world and a minted id whole', () => {
    expect(pathOf(id(), id('yard', 'crate'))).toBe('yard.crate');
    expect(pathOf(id(), id())).toBe('lane');
    expect(pathOf(id(), mintedId('lane', 3))).toBe('lane#3');
  });
});

describe('catalogueFor', () => {
  it('reads the bundle under the host’s default caps', () => {
    const catalogue = catalogueFor(lane());
    expect(catalogue.world).toBe('lane');
    expect(catalogue.arrival).toBe(id('yard'));
  });
});
