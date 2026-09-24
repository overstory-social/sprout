import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../source/diagnostics.js';
import { at, bodyOf, VESSEL } from '../fixtures/check.js';
import { readProseText } from '../fixtures/parse.js';
import { Scope } from './bindings.js';
import { PassageSites } from './speech.js';

describe('where passages are said from, recorded as bodies are checked', () => {
  it('keeps what each body said by name, in the order it said it, apart from every other body', () => {
    const sites = new PassageSites();
    const [one, two] = [
      { kind: 'play', at: at('self') },
      { kind: 'guard', at: at('item') },
    ];
    const scope = bodyOf(VESSEL).scope;
    sites.said(one, { name: 'taken', at: at('target'), scope, undrawn: null });
    sites.said(one, { name: 'dropped', at: at('tool'), scope, undrawn: null });
    sites.said(two, { name: 'full', at: at('item'), scope, undrawn: { by: 'permit' } });
    expect(sites.of(one).map((site) => site.name)).toEqual(['taken', 'dropped']);
    expect(sites.of(two).map((site) => site.name)).toEqual(['full']);
    expect(sites.of({ kind: 'handler', at: at('here') })).toEqual([]);
  });

  it('keeps every slot that renders a passage, and every slot that renders an option', () => {
    const sites = new PassageSites();
    const { prose } = readProseText('{a} {b}');
    const [slot] = prose.pieces;
    sites.render({
      name: 'greeting',
      at: at('thing'),
      kind: VESSEL,
      scope: Scope.root(),
      undrawn: null,
    });
    sites.option(slot!);
    sites.option(slot!);
    expect(sites.rendered.map((site) => site.name)).toEqual(['greeting']);
    expect([...sites.options]).toEqual([slot]);
  });

  it('is what a scope carried from a body holds, later names in the body not among it', () => {
    const scope = bodyOf(VESSEL).scope;
    const carried = scope.carried();
    scope.introduce(
      {
        name: 'later',
        type: { binds: 'object', kind: null },
        origin: 'let',
        at: at('n'),
        writable: false,
      },
      new Diagnostics(),
    );
    expect(carried.lookup('later')).toBeNull();
    expect(carried.names().sort()).toEqual(['actor', 'here', 'self']);
  });
});
