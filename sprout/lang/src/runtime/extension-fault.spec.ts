import { describe, expect, it } from 'vitest';

import { ExtensionFault, guarded } from './extension-fault.js';
import { faultOf } from './faults.js';
import { declaredId } from './ids.js';

const LAMP = declaredId('shop', ['lamp']);

describe('an extension’s code, run where it can be contained', () => {
  it('gives what the code gives', () => {
    expect(guarded('media', LAMP, 'running `media.show`', () => 7)).toBe(7);
  });

  it('turns a throw into a fault naming the extension and the object whose body ran it', () => {
    let caught: unknown;
    try {
      guarded('media', LAMP, 'running `media.show`', () => {
        throw new Error('no screen');
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(ExtensionFault);
    expect(faultOf(caught)).toEqual({
      name: 'ExtensionFault',
      detail: 'The extension `media` threw running `media.show`: no screen.',
      object: LAMP,
      engine: false,
      extension: 'media',
    });
  });

  it('turns a throw of what is not an error into the same fault', () => {
    expect(() =>
      guarded('media', null, 'rendering a value', () => {
        throw 'bare';
      }),
    ).toThrow('The extension `media` threw rendering a value: bare.');
  });
});
