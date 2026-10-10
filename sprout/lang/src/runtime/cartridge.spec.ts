import { describe, expect, it } from 'vitest';

import { emitCartridge, readCartridge } from '../bundle/cartridge.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { kindName } from '../declare/kinds.js';
import { compiledCorpusWorld as compiled, CORPUS_WORLDS as WORLDS } from '../fixtures/corpus.js';
import { catalogueOf } from './catalogue.js';
import { loadCartridge } from './cartridge.js';

describe('a cartridge runs under the host’s caps, not the ones it recorded', () => {
  it('reads the caps the host gives, while the cartridge keeps what it was checked against', () => {
    const bundle = compiled('act');
    const bytes = emitCartridge(bundle);
    const host = { ...DEFAULT_LIMITS.caps, listElements: DEFAULT_LIMITS.caps.listElements - 1 };
    expect(loadCartridge(bytes, { caps: host }).caps).toEqual(host);
    expect(readCartridge(bytes).caps).toEqual(bundle.caps);
  });
});

describe('a cartridge loads to the catalogue compiling the source makes', () => {
  it('has worlds to load', () => expect(WORLDS.length).toBeGreaterThan(40));

  for (const name of WORLDS) {
    it(name, () => {
      const bundle = compiled(name);
      const made = catalogueOf(bundle, DEFAULT_LIMITS.caps);
      const loaded = loadCartridge(emitCartridge(bundle), { caps: DEFAULT_LIMITS.caps });
      expect(loaded.world).toBe(made.world);
      expect([...loaded.declared.keys()]).toEqual([...made.declared.keys()]);
      expect([...loaded.declared.values()].map((one) => [one.container, one.rank])).toEqual(
        [...made.declared.values()].map((one) => [one.container, one.rank]),
      );
      expect(loaded.arrival).toBe(made.arrival);
      expect([...loaded.kinds.keys()]).toEqual([...made.kinds.keys()]);
      expect(loaded.lookup.all().map(kindName)).toEqual(made.lookup.all().map(kindName));
      expect(loaded.verbs.all().map((v) => `${v.library}.${v.name}`)).toEqual(
        made.verbs.all().map((v) => `${v.library}.${v.name}`),
      );
      expect(loaded.messages.all().map((m) => `${m.library}.${m.name}`)).toEqual(
        made.messages.all().map((m) => `${m.library}.${m.name}`),
      );
      expect(loaded.phrases.map((p) => [p.verb.name, p.parts, p.only])).toEqual(
        made.phrases.map((p) => [p.verb.name, p.parts, p.only]),
      );
      expect(loaded.intentPhrases.map((p) => [p.intent.name, p.parts])).toEqual(
        made.intentPhrases.map((p) => [p.intent.name, p.parts]),
      );
      expect([...loaded.words]).toEqual([...made.words]);
      expect(loaded.caps).toEqual(made.caps);
      expect(loaded.names.size).toBe(made.names.size);
      expect(loaded.optionSlots.size).toBe(made.optionSlots.size);
    });
  }
});
