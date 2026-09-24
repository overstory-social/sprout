import { declaredId, mintedId, type InstanceId } from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { checkWorld } from './check.js';
import { catalogueFor, INSPECTOR, pathOf, standIn } from './stand.js';
import { LANE, worldFolder } from './testing.js';

const lane = () => checkWorld(worldFolder('lane', LANE)).bundle!;
const id = (...path: string[]): InstanceId => declaredId('lane', path);

describe('standIn', () => {
  it('admits one visitor where visitors arrive, by an arrival turn, named Inspector', () => {
    const standing = standIn(lane());
    expect(standing.place).toBe(id('yard'));
    expect(standing.state.instances.get(standing.actor)!.container).toBe(id('yard'));
    const record = standing.state.visitors.get(standing.visit)!;
    expect(record).toMatchObject({ nickname: INSPECTOR, instance: standing.actor });
    expect(record.lastPlace).toBe(id('yard'));
  });

  it('stands them in another place, asked as a returning visitor’s last place is', () => {
    const standing = standIn(lane(), { at: 'shed', nickname: 'Marta' });
    expect(standing.place).toBe(id('shed'));
    expect(standing.state.visitors.get(standing.visit)!.nickname).toBe('Marta');
  });

  it('refuses a place its `accept` keeps them out of, naming where they came in instead', () => {
    expect(() => standIn(lane(), { at: 'attic' })).toThrow(
      '`attic` does not let a visitor in, so they came in at `yard`: its `accept`, or a bound on how many may stand there, turned them away.',
    );
  });

  it('refuses what is not a place, listing the places to write instead', () => {
    const message =
      "is not a place in lane, so nobody can stand there. After --at, write one of its places as the world's body names it: yard, shed, attic.";
    expect(() => standIn(lane(), { at: 'yard.crate' })).toThrow(`\`yard.crate\` ${message}`);
    expect(() => standIn(lane(), { at: 'loft' })).toThrow(`\`loft\` ${message}`);
  });

  it('refuses a nickname the world reads as a word, and says to give another', () => {
    expect(() => standIn(lane(), { nickname: 'crate' })).toThrow(
      '"crate" is a word this world already reads, so "crate" would not always mean you: choose another nickname. Give one with --as.',
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
