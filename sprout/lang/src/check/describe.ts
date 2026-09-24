// A `describe`, checked (the spec's Prose; Chance › Where chance is
// forbidden; Extensions › Effects are additive; The compiler › What it
// refuses, What absent means).
//
// Inside, `self` is the thing described, `actor` whoever is looking,
// typed as `sprout.Actor`, and `here` their place, typed as a role's is.
// A describe only reads,
// as `blocks.ts` checks it: it gives its words with `text`, draws nothing,
// and writes, sends, moves, spawns, says and tells nothing. One with no
// `text` anywhere in it would be empty on a text client, and is refused;
// one whose every `text` names a passage of a `.prose` file that is absent
// is told to `emptied`, which refuses it at publish.

import { statementsWithin, type Block, type Statement } from '../syntax/ast.js';
import {
  describeWord,
  type DescribeDeclaration,
  type TextStatement,
} from '../syntax/ast-speech.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import { SPROUT } from '../declare/enums.js';
import type { HereKind } from '../declare/places.js';
import type { ResolvedDescribe } from '../declare/describe.js';
import { actorBinding, hereBinding, Scope, selfBinding } from './bindings.js';
import type { CheckContext, MessageSetting } from './check.js';
import type { NameScope } from './names.js';
import { checkBlock } from './blocks.js';
import type { SpeechBook } from './speech.js';
import type { PinnedExtensions } from '../declare/extensions.js';

/** Where a describe is read: the kinds in scope, and somewhere to say what is wrong. */
export interface DescribeSetting {
  readonly kinds: KindLookup;
  /** What `here` is typed as in this world. */
  readonly here: HereKind;
  readonly diagnostics: Diagnostics;
  /** Where the body's identifiers resolve from; with none, only bindings are names. */
  readonly names?: NameScope;
  readonly messages?: MessageSetting;
  /** Where what the body says is recorded. */
  readonly speech?: SpeechBook;
  /** The extensions the bundle pins, whose statements the body may write. */
  readonly extensions?: PinnedExtensions;
  /**
   * Told of a describe whose every `text` names a passage `self` does not
   * have, which is so where the `.prose` file that held them is absent.
   */
  readonly emptied?: (self: KindRef, describe: DescribeDeclaration) => void;
}

/**
 * Check the describe `self` wrote, in the scope a thing being looked at
 * has. Returns whether nothing in it was refused.
 */
export function checkDescribe(
  describe: ResolvedDescribe,
  self: KindRef,
  setting: DescribeSetting,
): boolean {
  const { diagnostics } = setting;
  const before = diagnostics.refusals.length;
  const declaration = describe.declaration;
  const at = describeWord(declaration);
  const scope = Scope.root();
  scope.introduce(selfBinding(self, at), diagnostics);
  scope.introduce(actorBinding(setting.kinds.qualified(SPROUT, 'Actor'), at), diagnostics);
  scope.introduce(hereBinding(setting.here, at), diagnostics);
  const context: CheckContext = {
    scope,
    kinds: setting.kinds,
    from: self.library,
    self,
    diagnostics,
    ...(setting.names === undefined ? {} : { names: setting.names }),
    ...(setting.messages === undefined ? {} : { messages: setting.messages }),
    ...(setting.extensions === undefined ? {} : { extensions: setting.extensions }),
    ...(setting.speech === undefined ? {} : { speech: { ...setting.speech, body: declaration } }),
  };
  checkBlock(declaration.body, context, { body: 'describe' });

  const texts = textsIn(declaration.body);
  if (texts.length === 0) {
    diagnostics.refuse(
      at,
      `This \`describe\` has no \`text\`, so whoever looks at \`${self.name}\` would read nothing.`,
      'Give it its words with `text`, as in `describe { text "Slat-sided, heavier than it looks." }`.',
    );
  } else if (
    texts.every(({ said }) => said.kind === 'ident' && !self.passages.has(said.text)) &&
    setting.emptied !== undefined
  ) {
    setting.emptied(self, declaration);
  }
  return diagnostics.refusals.length === before;
}

/** Every `text` in a block, in every branch of every `if` and the body of every `each`, in the order written. */
export function textsIn(block: Block): TextStatement[] {
  const found: TextStatement[] = [];
  const walk = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === 'text') found.push(statement);
      walk(statementsWithin(statement));
    }
  };
  walk(block.statements);
  return found;
}
