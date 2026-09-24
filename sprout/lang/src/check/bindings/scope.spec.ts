// A scope says what is in reach, looking outward through nesting far
// deeper than a body could ever go without recursing; shadowing a name
// already in scope is a compile error, wherever it is bound from;
// `is()` narrows a binding's kind for the branch alone, without
// shadowing it; and every path in `bindings.ts` that declines to make a
// binding still says why, at a place, in words a non-programmer can act on.

import { describe, expect, it } from 'vitest';

import {
  actorBinding,
  handlerParameters,
  hereBinding,
  isObjectBinding,
  letBinding,
  loopBinding,
  objectOf,
  OPEN_OBJECT,
  roleBinding,
  Scope,
  selfBinding,
  setRoleBinding,
  valueOf,
} from '../bindings.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { locationOf } from '../../source/source.js';
import { BOOLEAN, integer, STRING } from '../../declare/types.js';
import {
  at,
  CONTAINER,
  FILE,
  fromProperty,
  fromRange,
  HERE_UNKNOWN,
  KNOWS,
  LOCKABLE,
  message,
  parameters,
  SIZES,
  thingNamed,
  trying,
  VESSEL,
  VISITOR,
} from '../../fixtures/bindings.js';

describe('a scope says what is in reach', () => {
  it('finds a name introduced into it', () => {
    const scope = Scope.root();
    expect(scope.introduce(selfBinding(VESSEL, at('self')), new Diagnostics())).toBe(true);
    expect(scope.lookup('self')!.type).toEqual(objectOf(VESSEL));
    expect(scope.lookup('actor')).toBeNull();
  });

  it('looks outward, so a block sees what surrounds it', () => {
    const outer = Scope.root();
    outer.introduce(selfBinding(VESSEL, at('self')), new Diagnostics());
    const inner = outer.inner();
    inner.introduce(letBinding('n', valueOf(integer()), at('n')), new Diagnostics());

    expect(inner.lookup('self')!.origin).toBe('self');
    expect(inner.lookup('n')!.origin).toBe('let');
    expect(inner.own('self')).toBeNull();
    expect(inner.own('n')!.origin).toBe('let');
    expect(outer.lookup('n')).toBeNull();
  });

  it('lists every name in reach, nearest first and each once', () => {
    const outer = Scope.root();
    outer.introduce(selfBinding(VESSEL, at('self')), new Diagnostics());
    outer.introduce(hereBinding(HERE_UNKNOWN, at('here')), new Diagnostics());
    const inner = outer.inner();
    inner.introduce(letBinding('n', valueOf(integer()), at('n')), new Diagnostics());

    expect(inner.names()).toEqual(['n', 'self', 'here']);
    expect(new Set(inner.names()).size).toBe(inner.names().length);
  });
});

describe('a scope goes as deep as blocks nest, and says so rather than dying', () => {
  // `lookup` and `names` walk the chain iteratively: by recursion, both
  // would throw `RangeError` out of a file whose whole job is producing
  // diagnostics. The depth here is far past anything a body will nest
  // and costs the suite a few milliseconds.
  const DEEP = 40_000;

  function nested(depth: number): Scope {
    const root = Scope.root();
    root.introduce(selfBinding(VESSEL, at('self')), new Diagnostics());
    root.introduce(hereBinding(HERE_UNKNOWN, at('here')), new Diagnostics());
    let scope = root;
    for (let i = 0; i < depth; i++) scope = scope.inner();
    return scope;
  }

  it('finds a name through a chain far deeper than a body could nest', () => {
    const deep = nested(DEEP);
    expect(deep.lookup('self')!.type).toEqual(objectOf(VESSEL));
    expect(deep.lookup('nothing')).toBeNull();
  });

  it('lists what is in reach through one, without throwing', () => {
    expect(nested(DEEP).names()).toEqual(['self', 'here']);
  });

  it('still refuses a shadow from the bottom of one', () => {
    const deep = nested(DEEP);
    const { made, said } = trying((d) =>
      deep.introduce(letBinding('self', valueOf(BOOLEAN), at('self')), d),
    );
    expect(made).toBe(false);
    expect(said.join(' ')).toContain('`self` already names');
  });
});

describe('shadowing is a compile error', () => {
  it('refuses a `let` taking the name of a role already in scope', () => {
    const scope = Scope.root();
    scope.introduce(setRoleBinding('tools', null, at('tools')), new Diagnostics());
    const { made, said } = trying((d) =>
      scope.introduce(letBinding('tools', valueOf(integer()), at('tools')), d),
    );
    expect(made).toBe(false);
    expect(said.join(' ')).toContain('already names');
    expect(said.join(' ')).toContain("this verb's role");
  });

  it('refuses it from a block inside the one that bound it', () => {
    const outer = Scope.root();
    outer.introduce(loopBinding('pot', VESSEL, at('pot')), new Diagnostics());
    const inner = outer.inner().inner();
    const { made, said } = trying((d) =>
      inner.introduce(letBinding('pot', valueOf(integer()), at('pot')), d),
    );
    expect(made).toBe(false);
    expect(said.join(' ')).toContain('loop variable');
  });

  it('refuses a role taking the name of something the engine supplies', () => {
    const scope = Scope.root();
    scope.introduce(selfBinding(VESSEL, at('self')), new Diagnostics());
    scope.introduce(actorBinding(VISITOR, at('actor')), new Diagnostics());
    for (const name of ['self', 'actor']) {
      const { made, said } = trying((d) =>
        scope.introduce(setRoleBinding(name, null, at(name)), d),
      );
      expect(made, name).toBe(false);
      expect(said.join(' '), name).toContain(`\`${name}\` already names`);
    }
  });

  it('leaves the scope as it was when it refuses, so the first name still means what it did', () => {
    const scope = Scope.root();
    scope.introduce(loopBinding('pot', VESSEL, at('pot')), new Diagnostics());
    scope.introduce(letBinding('pot', valueOf(BOOLEAN), at('pot')), new Diagnostics());
    expect(scope.lookup('pot')!.type).toEqual(objectOf(VESSEL));
    expect(scope.lookup('pot')!.origin).toBe('each');
  });

  it('says where the second one was written, not where the first was', () => {
    const scope = Scope.root();
    scope.introduce(hereBinding(HERE_UNKNOWN, at('here')), new Diagnostics());
    const { diagnostics } = trying((d) =>
      scope.introduce(letBinding('here', valueOf(BOOLEAN), at('here')), d),
    );
    expect(diagnostics.all).toHaveLength(1);
    expect(diagnostics.all[0]!.at.source).toBe(FILE);
  });

  it('allows the same name in two scopes neither of which contains the other', () => {
    const outer = Scope.root();
    const first = outer.inner();
    const second = outer.inner();
    expect(first.introduce(letBinding('n', valueOf(BOOLEAN), at('n')), new Diagnostics())).toBe(
      true,
    );
    expect(second.introduce(letBinding('n', valueOf(STRING), at('n')), new Diagnostics())).toBe(
      true,
    );
    expect(first.lookup('n')!.type).toEqual(valueOf(BOOLEAN));
    expect(second.lookup('n')!.type).toEqual(valueOf(STRING));
  });
});

describe('`is()` narrows, which is not shadowing', () => {
  it('reads a kind’s own properties through a binding of object type', () => {
    const scope = Scope.root();
    const thing = hereBinding(HERE_UNKNOWN, at('here'));
    scope.introduce(thing, new Diagnostics());
    expect(isObjectBinding(thing)).toBe(true);

    const branch = scope.narrowing(thingNamed(thing), VESSEL);
    expect(branch.lookup('here')!.type).toEqual(objectOf(VESSEL));
    expect(scope.lookup('here')!.type).toEqual(OPEN_OBJECT);
  });

  it('keeps everything about the binding but its kind', () => {
    const scope = Scope.root();
    const target = roleBinding('target', { fills: 'open' }, null, at('target'), new Diagnostics())!;
    scope.introduce(target, new Diagnostics());
    const branch = scope.narrowing(thingNamed(target), LOCKABLE);
    const narrowed = branch.lookup('target')!;

    expect(narrowed.origin).toBe(target.origin);
    expect(narrowed.at).toBe(target.at);
    expect(narrowed.writable).toBe(target.writable);
    expect(narrowed.type).toEqual(objectOf(LOCKABLE));
  });

  it('lasts for the branch and no longer', () => {
    const scope = Scope.root();
    const self = selfBinding(VESSEL, at('self'));
    scope.introduce(self, new Diagnostics());
    const branch = scope.narrowing(thingNamed(self), CONTAINER);
    const deeper = branch.inner();

    expect(deeper.lookup('self')!.type).toEqual(objectOf(CONTAINER));
    expect(scope.lookup('self')!.type).toEqual(objectOf(VESSEL));
    expect(scope.names()).toEqual(['self']);
  });

  it('narrows a name once, not twice: the branch holds one binding for it', () => {
    const scope = Scope.root();
    const self = selfBinding(VESSEL, at('self'));
    scope.introduce(self, new Diagnostics());
    const branch = scope.narrowing(thingNamed(self), CONTAINER);
    expect(branch.names()).toEqual(['self']);
  });
});

describe('nothing ends without saying something', () => {
  // Every path in this file that declines to make a binding, each paired
  // with what it must still hand back. A path that returned null in
  // silence would be a body compiled against a binding nobody typed.
  const declining: { what: string; run: (d: Diagnostics) => unknown; keeps: number }[] = [
    {
      what: 'a symbol role that has not said what it hears',
      run: (d) => roleBinding('topic', { fills: 'symbol' }, null, at('topic'), d),
      keeps: 0,
    },
    {
      what: 'a symbol role narrowed by a range',
      run: (d) => roleBinding('topic', { fills: 'symbol' }, fromRange(1, 2), at('topic'), d),
      keeps: 0,
    },
    {
      what: 'a symbol role narrowed by a list of something else',
      run: (d) => roleBinding('topic', { fills: 'symbol' }, fromProperty(SIZES), at('topic'), d),
      keeps: 0,
    },
    {
      what: 'an integer role narrowed by a list',
      run: (d) => roleBinding('n', { fills: 'integer' }, fromProperty(KNOWS), at('n'), d),
      keeps: 0,
    },
    {
      what: 'a range that counts downward',
      run: (d) => roleBinding('n', { fills: 'integer' }, fromRange(9, 1), at('n'), d),
      keeps: 0,
    },
    {
      what: 'a `from` on an open role',
      run: (d) => roleBinding('target', { fills: 'open' }, fromProperty(KNOWS), at('target'), d),
      keeps: 0,
    },
    {
      what: 'a `from` on a kind role',
      run: (d) =>
        roleBinding('target', { fills: 'kind', kind: LOCKABLE }, fromRange(1, 2), at('target'), d),
      keeps: 0,
    },
    {
      what: 'a value bound on a message that carries none',
      run: (d) => handlerParameters(message('gust'), parameters('from', 'value'), at('value'), d),
      keeps: 1,
    },
    {
      what: 'a third handler parameter',
      run: (d) =>
        handlerParameters(
          message('illuminating'),
          parameters('from', 'value', 'item'),
          at('item'),
          d,
        ),
      keeps: 0,
    },
  ];

  it('keeps only what it could type, and says why for the rest', () => {
    for (const { what, run, keeps } of declining) {
      const diagnostics = new Diagnostics();
      const made = run(diagnostics);
      const kept = made === null ? 0 : Array.isArray(made) ? made.length : 1;
      expect(kept, what).toBe(keeps);
      expect(diagnostics.refusals.length, `${what}: said nothing`).toBe(1);
    }
  });

  it('names a place and tells a non-programmer what to write instead', () => {
    for (const { what, run } of declining) {
      const diagnostics = new Diagnostics();
      run(diagnostics);
      for (const refusal of diagnostics.refusals) {
        expect(refusal.message, what).not.toBe('');
        expect(refusal.remedy ?? '', `${what}: offered no remedy`).not.toBe('');
        expect(locationOf(refusal.at), what).toMatch(/^shop\.sprout:\d+:\d+$/);
      }
    }
  });
});

describe('a name withheld where it stands', () => {
  const words = { message: '`tool` may be missing here.', remedy: 'Ask `bound tool` first.' };
  const tool = () => roleBinding('tool', { fills: 'open' }, null, at('tool'), new Diagnostics())!;
  const withheld = () => ({
    name: 'tool',
    at: at('tool'),
    unread: words,
    bound: { bindable: true as const, binding: tool() },
  });

  it('is not what `lookup` finds, and is found outward by `withheld`', () => {
    const scope = Scope.root();
    expect(scope.withhold(withheld(), new Diagnostics())).toBe(true);
    const inner = scope.inner().inner();
    expect(inner.lookup('tool')).toBeNull();
    expect(inner.withheld('tool')!.unread).toBe(words);
    expect(inner.names()).not.toContain('tool');
  });

  it('is bound in a branch `bounding` opens, and nowhere else', () => {
    const scope = Scope.root();
    scope.withhold(withheld(), new Diagnostics());
    const branch = scope.bounding(tool());
    expect(branch.lookup('tool')!.type).toEqual(OPEN_OBJECT);
    expect(scope.lookup('tool')).toBeNull();
  });

  it('takes a name as a binding does: a second thing answering to it is refused, either way round', () => {
    const scope = Scope.root();
    scope.withhold(withheld(), new Diagnostics());
    const said = new Diagnostics();
    expect(scope.inner().introduce(letBinding('tool', valueOf(BOOLEAN), at('tool')), said)).toBe(
      false,
    );
    expect(said.refusals.map((d) => d.message)).toEqual([
      "`tool` already names this verb's role here.",
    ]);

    const other = Scope.root();
    other.introduce(hereBinding(HERE_UNKNOWN, at('here')), new Diagnostics());
    const again = new Diagnostics();
    expect(other.withhold({ ...withheld(), name: 'here' }, again)).toBe(false);
    expect(again.refusals.map((d) => d.message)).toEqual([
      "`here` already names the actor's place here.",
    ]);
  });
});

describe('what a scope carries to a passage said from it', () => {
  const withheldTool = {
    name: 'tool',
    at: at('tool'),
    unread: { message: '`tool` may be missing here.', remedy: 'Ask `bound tool` first.' },
    bound: { bindable: false as const, words: { message: 'never', remedy: 'never' } },
  };

  it('is everything in reach, nearest winning, as one scope of its own', () => {
    const outer = Scope.root();
    outer.introduce(selfBinding(VESSEL, at('self')), new Diagnostics());
    outer.withhold(withheldTool, new Diagnostics());
    const inner = outer.inner();
    inner.introduce(letBinding('n', valueOf(integer()), at('n')), new Diagnostics());
    const carried = inner.carried();
    expect(
      carried
        .bound()
        .map((binding) => binding.name)
        .sort(),
    ).toEqual(['n', 'self']);
    expect(carried.withheldNames()).toEqual(['tool']);
    expect(carried.withheld('tool')?.unread.message).toBe('`tool` may be missing here.');
  });

  it('keeps the narrowed type a branch gave a name', () => {
    const outer = Scope.root();
    const target = roleBinding('target', { fills: 'open' }, null, at('target'), new Diagnostics())!;
    outer.introduce(target, new Diagnostics());
    const branch = outer.narrowing(thingNamed(target), CONTAINER);
    expect(branch.carried().lookup('target')!.type).toEqual(objectOf(CONTAINER));
  });

  it('leaves out what it is told to', () => {
    const outer = Scope.root();
    outer.introduce(selfBinding(VESSEL, at('self')), new Diagnostics());
    outer.introduce(hereBinding(HERE_UNKNOWN, at('here')), new Diagnostics());
    outer.withhold(withheldTool, new Diagnostics());
    const carried = outer.carried(new Set(['self', 'tool']));
    expect(carried.names()).toEqual(['here']);
    expect(carried.withheldNames()).toEqual([]);
  });

  it('is not reached by what the scope it came from takes in afterwards', () => {
    const outer = Scope.root();
    const carried = outer.carried();
    outer.introduce(hereBinding(HERE_UNKNOWN, at('here')), new Diagnostics());
    expect(carried.lookup('here')).toBeNull();
  });
});
