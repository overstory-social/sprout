// A line said, rendered for one reader (the spec's Prose; Limits ›
// Runtime budgets: output per turn, per recipient). What a body said is
// carried unrendered, with the names in scope where it was said; this is
// where it becomes words, once for each reader, since a line naming its
// reader says "you" to them and their name to everyone else, and what it
// draws is drawn once, for every reader (`line-draws.ts`). What it
// renders is charged to that reader's output (`output.ts`), so a crowd
// costs the host and never the one acting.

import { libraryOf } from '../declare/enums.js';
import type { Speech } from '../runtime/body.js';
import type { Evaluated } from '../runtime/evaluate.js';
import type { InstanceId } from '../runtime/ids.js';
import { charged } from './output.js';
import { reflow } from './reflow.js';
import { renderProse, type RenderContext } from './render.js';

/** A line to render: who said it, which is `self` when it renders, and the names in scope where it was said. */
export interface Line {
  readonly by: InstanceId;
  readonly said: Speech;
  readonly bindings: ReadonlyMap<string, Evaluated>;
}

/**
 * The paragraphs `line` renders to for `reader`, charged to what `reader`
 * may be told this turn; none where they do not fit someone other than
 * the actor. A named passage runs one passage deep; one that is absent
 * renders nothing.
 */
export function renderFor(line: Line, reader: InstanceId, context: RenderContext): string[] {
  const { said } = line;
  if ('absent' in said) return [];
  const draws = context.draws?.of(line) ?? null;
  const rendered =
    'passage' in said
      ? context.budget.passage(() =>
          renderProse(
            said.passage.body.prose,
            { self: line.by, library: libraryOf(said.passage.origin), bindings: line.bindings },
            reader,
            context,
            draws,
          ),
        )
      : renderProse(
          said.prose,
          { self: line.by, library: said.library, bindings: line.bindings },
          reader,
          context,
          draws,
        );
  const paragraphs = reflow(rendered);
  const characters = paragraphs.reduce((sum, paragraph) => sum + [...paragraph].length, 0);
  return charged(context, reader, characters) ? paragraphs : [];
}
