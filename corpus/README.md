# The corpus

Worlds `sprout check` is run over in the gate (`npm run check`,
`scripts/check-corpus.mjs`). Everything under `good/` passes with no
refusals, and a `good/<name>/expected.txt` pins the page of one that
warns; everything under `bad/` fails, and each `bad/<name>/expected.txt`
is the exact page the compiler prints for it, so the compiler's words to an
author cannot drift without a test noticing. `node scripts/check-corpus.mjs
--write` regenerates the pages; the diff is reviewed like any other change.

A world here is a folder with `sprout.json` and its files, the same shape
`sprout init` writes. Add a `good/` world when a construct lands, and a
`bad/` world for each refusal worth pinning the words of.
