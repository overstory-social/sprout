# @overstory/sprout

Sprout is a small language for interactive rooms and objects — the kind
of thing a text adventure is made of, written by the people who visit
it. A definition declares fields, views (guard → prose), verbs (guard →
effects) and handlers for named messages; the computation class is
total, bounded and deterministic, so a definition can be run inside a
database transaction with no model in the loop and nothing leaving the
server.

This package is the language on its own, MIT-licensed:

- `definitions.ts` — the stored definition format (zod), its caps, and
  the save-time cross-validation.
- `sprout.ts`, `sprout-lang.ts` — the written language: lexer, parser,
  compiler to the definition format, and the printer back.
- `sprout-skill.ts` — a generated reference that teaches the language.
- `engine.ts` — runs a verb or a move against a world of objects.
- `parser.ts` — turns typed words into a verb, Inform-style.

It imports `zod` and nothing else (`boundary.spec.ts` holds that line).
The world it runs in — who is standing where, what they may reach, how
definitions are published — belongs to the host. Overstory Social is the
first host; the language spec is `sprout.md` at the repository root.

Stage 1 of the split (2026-09-16): a workspace package inside the
Overstory monorepo, `private` until it is published on its own.
