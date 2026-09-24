// Running an extension's statement (the spec's Extensions › The rule,
// Trust). It records an effect and never performs one: its arguments are
// evaluated, handed to the extension frozen with who ran it, and what
// comes back is checked against the statement's effect schema and given
// the transcript line a text-only client shows instead. The run is a step
// and one of the host's capped effects; a throw, a payload its schema
// refuses, or an empty transcript faults the turn, naming the extension.
// A statement of an absent extension records nothing.

import type { ExtensionStatement as Written } from '../syntax/ast-extensions.js';
import {
  extensionStatement,
  frozenPlain,
  type Plain,
  type PinnedExtension,
} from '../declare/extensions.js';
import { parameterType } from '../declare/types.js';
import { evaluate, type Frame } from './evaluate.js';
import { ExtensionFault, guarded } from './extension-fault.js';
import { ExtensionValue, extensionLiteral } from './extension-values.js';
import { SproutList } from './lists.js';
import type { Value } from './values.js';

/** What one run of an extension's statement recorded: the payload for a client that can use it, and the words for one that cannot. */
export interface Recorded {
  readonly extension: string;
  readonly statement: string;
  readonly payload: Plain;
  readonly transcript: string;
}

/** What `written`, run in `frame`, records; null where its extension is absent. */
export function recordOf(
  written: Written,
  frame: Frame,
  extensions: ReadonlyMap<string, PinnedExtension>,
): Recorded | null {
  const pinned = extensions.get(written.extension.text);
  if (pinned === undefined || pinned.installed === null) return null;
  const extension = pinned.installed;
  const statement = extensionStatement(pinned, written.name.text);
  if (statement === null) {
    throw new Error(
      `\`${written.extension.text}.${written.name.text}\` reached the runtime; the checker refuses a statement its extension lacks.`,
    );
  }
  const args = written.arguments.map((argument, index) => {
    const parameter = statement.parameters[index];
    const type = parameter === undefined ? null : parameterType(extension, parameter);
    if (type?.type === 'extension' && argument.kind === 'string') {
      frame.budget.spend();
      return extensionLiteral(type, argument.value).value;
    }
    const evaluated = evaluate(argument, frame);
    if (evaluated.binds !== 'value') {
      throw new Error(
        `a ${evaluated.binds} was handed to an extension, which the checker refuses.`,
      );
    }
    return plainOf(evaluated.value);
  });
  frame.budget.spend();
  frame.budget.record();

  const actor = frame.bindings.get('actor');
  const handed = {
    arguments: Object.freeze(args),
    self: frame.self,
    actor: actor?.binds === 'object' ? actor.id : null,
  };
  const name = `${extension.name}.${statement.name}`;
  const ran = guarded(extension.name, frame.self, `running \`${name}\``, () =>
    statement.run(Object.freeze(handed)),
  );
  const payload = frozenPlain(ran);
  if (payload === undefined) {
    throw new ExtensionFault(
      extension.name,
      frame.self,
      `recorded from \`${name}\` what is not plain.`,
    );
  }
  const valid = guarded(
    extension.name,
    frame.self,
    `validating \`${name}\``,
    () => statement.effect.safeParse(payload).success,
  );
  if (!valid) {
    throw new ExtensionFault(
      extension.name,
      frame.self,
      `recorded from \`${name}\` an effect its schema refuses.`,
    );
  }
  const transcript = guarded(
    extension.name,
    frame.self,
    `writing the transcript of \`${name}\``,
    () => statement.transcript(payload),
  );
  if (typeof transcript !== 'string' || transcript.trim() === '') {
    throw new ExtensionFault(
      extension.name,
      frame.self,
      `gave \`${name}\` no transcript line, which a text-only client would read as silence.`,
    );
  }
  return { extension: extension.name, statement: statement.name, payload, transcript };
}

/** A value as an extension is handed it: a list as its elements, an extension's value as its reading. */
function plainOf(value: Value): Plain {
  if (value instanceof ExtensionValue) return value.value;
  if (value instanceof SproutList) return Object.freeze(value.elements.map(plainOf));
  return value;
}
