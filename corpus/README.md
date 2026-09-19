# The corpus

Archives `sprout check` is run over in the gate (`npm run check`,
`scripts/check-corpus.mjs`): everything under `good/` must pass with no
problems, everything under `bad/` must fail, and each `bad/<name>/expect.json`
names the problems it must fail WITH — file, line, column and message, exactly
— so the compiler's words to a builder cannot drift without a test noticing.
The two example studios under `sprout/examples` are checked as well.
