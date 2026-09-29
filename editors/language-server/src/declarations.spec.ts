import { positionOf } from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { specifierOf, type Declared } from './declarations.js';
import { indexOf } from './fixtures/worlds.js';

const where = (one: Declared) => `${one.at.source.name}:${positionOf(one.at).line}`;
const own = (name: string) => indexOf(name).declared.filter((one) => one.library === null);

describe('declarationsOf', () => {
  const shop = own('printers_shop');

  it('names each kind, enum, option, object and world where its name is written', () => {
    const key = shop.find((one) => one.name === 'Key' && one.as === 'kind')!;
    expect(where(key)).toBe('key.sprout:4');
    expect(key.head).toBe('kind Key');
    expect(key.at.source.text.slice(key.at.start, key.at.end)).toBe('Key');
    const ward = shop.filter((one) => one.owner === 'Ward').map((one) => [one.name, one.as]);
    expect(ward).toEqual([
      ['brass', 'option'],
      ['iron', 'option'],
    ]);
    expect(shop.find((one) => one.name === 'composing_room')).toMatchObject({
      as: 'object',
      head: 'object composing_room is sprout.Place',
    });
    expect(shop.find((one) => one.as === 'world')?.name).toBe('printers_shop');
  });

  it('names a property and a memory with the kind or object that declares it', () => {
    expect(shop.find((one) => one.name === 'wear')).toMatchObject({
      as: 'property',
      owner: 'Key',
      head: ':wear  0 min 0 max 99',
    });
    expect(
      shop.find((one) => one.name === 'visits' && one.owner === 'composing_room'),
    ).toMatchObject({ as: 'memory' });
  });

  it('gives a `.prose` file’s passages to whoever names the file', () => {
    const arrival = shop.find((one) => one.name === 'arrival' && one.as === 'passage')!;
    expect(where(arrival)).toBe('composing_room.prose:1');
    expect(arrival.owner).toBe('composing_room');
  });

  it('reads each library’s declarations as its own, by the library’s name', () => {
    const container = indexOf('imports').declared.find((one) => one.name === 'Container')!;
    expect(container).toMatchObject({ as: 'kind', library: 'sprout', owner: null });
    expect(specifierOf(container)).toBe('sprout');
  });

  it('records what each file imports, under the name it goes by there', () => {
    const imports = indexOf('imports').imports.filter((one) => one.file === 'imports.sprout');
    expect(imports).toEqual([
      { file: 'imports.sprout', local: 'Person', name: 'Person', message: false, from: 'person' },
      { file: 'imports.sprout', local: 'sprout', name: null, message: false, from: 'sprout' },
      { file: 'imports.sprout', local: 'Box', name: 'Chest', message: false, from: 'things/chest' },
      {
        file: 'imports.sprout',
        local: 'cellar',
        name: 'cellar',
        message: false,
        from: 'rooms/cellar',
      },
    ]);
  });

  it('gives a world file’s declarations its path without `.sprout` as their specifier', () => {
    const chest = own('imports').find((one) => one.name === 'Chest')!;
    expect(specifierOf(chest)).toBe('things/chest');
  });
});
