# Sprout — house rules

Sprout is a language for small multiplayer interactive-fiction worlds, and
the runtime that hosts them. It is **unreleased and being built from the
spec**: `docs/design/sprout-design-spec.md` is the language as it is to be
built, and **where anything disagrees with it, the spec wins**. The code
implements the spec one backlog item at a time; the previous
implementation was deleted on 2026-09-22 (#71) and nothing of it is a
constraint or a reference.

Orientation: `README.md` (layout and commands);
`docs/design/sprout-working-notes.md` (the reasoning behind the spec, its
_Decisions_ and its _Holes in the spec_);
`docs/design/sprout-build-backlog.md` (53 numbered items, one GitHub issue
each — item B*nn* is issue #_nn_; #54 is the tracking issue and the build
order); `docs/design/sprout-test-harness.md` (how this code is tested and
why). Older files under `docs/design/` are dated and superseded.

## The work

- **Every change is a backlog issue.** Take the lowest-numbered open issue
  labelled `ready` that nobody has claimed; claim it (assign yourself or
  comment) before starting; do not start an issue whose _Depends on_ list
  has an open member. When yours closes, label its unblocked dependents
  `ready`. Work that is not an issue — a bug, a doc fix — gets one first, or
  says in its PR why it is too small to.
- **Read the spec sections the issue names before writing code**, and the
  matching _Decisions_ in the working notes. The issue paraphrases the spec;
  where they disagree the issue is wrong. Where the spec is silent, say so
  in the PR and add a line under the notes' _Holes in the spec_ — never
  invent quietly. Do not edit the spec to match code; propose the change in
  the PR and let Eric decide.

## Where code goes

`sprout/lang/src` is laid out by layer, and a new file goes in the layer
that names what it does. A file in one layer imports from the layers above
it and never from the ones below.

| layer      | holds                                                                          | may import from                  |
| ---------- | ------------------------------------------------------------------------------ | -------------------------------- |
| `source/`  | spans, the AST node rule, diagnostics, hashing                                 | nothing                          |
| `syntax/`  | lexer, AST, parser                                                             | `source/`, `bundle/limits`       |
| `declare/` | what a declaration means: types, enums, kinds, properties, messages, the world | `source/`, `syntax/`             |
| `check/`   | bindings, scope, the expression and statement checker                          | `source/`, `syntax/`, `declare/` |
| `bundle/`  | limits, the manifest, the bundle, `compileBundle`, absence                     | everything above                 |
| `runtime/` | the budget meter, values, and (from B22 on) the engine                         | everything above                 |
| `prose/`   | (from B29) passages, slots, rendering                                          | everything above                 |

Rules that follow from the table:

- **One file, one concern, and a file stays readable.** When a file passes
  about 800 lines, split it on its section comments into a folder of
  modules that take a context object; do not grow a class. `syntax/parse/`
  and `bundle/compile/` are the model: grammar areas and compile stages as
  modules of functions taking the parser or the report. `check/check.ts`
  is past the line and splits next, by expression area; the spec files
  past it are #122's.
- **Functions over a context, not methods on a god object.** A class is
  earned only by real mutable state every method needs (the parser's cursor,
  the budget's counters, a scope). Evaluation, checking, rendering and
  resolution are functions that take what they read.
- **No old names, no shims.** Nothing is named around something that used
  to exist. If a better name is taken, the thing holding it is renamed or
  deleted in the same PR.
- **A spec file beside every source file** (`foo.ts` → `foo.spec.ts`) that
  exercises it directly; coverage through another file's spec does not
  count. Test-only entry points are not exported from `index.ts`.

## Comments

A comment says **what is true now** and, where it is not obvious, **why the
spec or the design wants it that way**. It never says how the code got
here. Concretely:

- No issue or PR numbers (`#59`), no "before B12", no "the previous
  language", no "this used to", no anecdotes about a bug or a regression, no
  counts of how many times something was reported. Git holds the history;
  the PR body holds the argument. A backlog item named as the **owner of
  work not yet done** is fine, because it is a fact about the plan: "B29
  reads passage bodies" stays until B29 lands, and is removed then.
- A file header is a short paragraph: what the module is, which spec
  section it implements, and the one or two invariants a reader must know.
  Not an essay.
- A function's doc comment is one to three sentences. If it needs more, the
  function does too much.
- Prefer a spec citation over a paraphrase: "the spec's Limits › Runtime
  budgets" beats three sentences restating it.
- When you touch a comment that breaks these rules, fix it in passing.

## The harness

`docs/design/sprout-test-harness.md` says what each layer of testing is
for. The short form:

- **Colocated specs** are the unit layer. Assert on the rule, not on the
  fixture: a test that would pass for any output is not a test.
- **The corpus** (`corpus/good`, `corpus/bad`) is the golden layer, run by
  `npm run check`. Every construct that lands gets a `good/` world, and
  every refusal worth pinning the words of gets a `bad/` world whose
  `expected.txt` is the exact page. Regenerate with
  `node scripts/check-corpus.mjs --write` and read the diff before
  committing it: a golden that was rewritten to whatever the code now says,
  with no judgement of whether it is right, is a finding in review.
- **Invariants over generated input** live in the spec of the module they
  guard (the parser's "a well-formed item never vanishes silently" is the
  model). A recovery or resync change without such a test is not done.
- **The boundary specs** pin what each package may import. They are never
  fenced or loosened to make something build.
- **The conformance suite** (`sprout/core/src/conformance.ts`) is what every
  store adapter passes, under any test runner. It is never fenced.

## The gate, locally

There is **no CI**. Every check runs on the machine of whoever is
committing, and a PR carries the evidence.

- **`npm run gate` before every commit** — lint, prettier, both builds,
  every suite, the spec typechecks, the corpus. Green, or the commit does
  not happen. There is no "legacy" category of failure any more: a red gate
  is a bug in the change.
- **`npm run e2e` before opening a PR** — packs both tarballs, installs them
  into an empty folder, and runs `sprout init` and `sprout check` from the
  installed CLI over a fresh world and a corpus world. B49 (the worked
  microworld as a fixture, with golden transcripts) extends it.
- **The PR body carries the receipts**: the short sha the gate ran at, its
  last line, and the same for e2e. A reviewer re-runs the gate at the PR
  head in a worktree; a PR without receipts is not ready.

## Branches, PRs, review, merge

- `main` is the integration head. **All work happens on a branch** cut
  from `main`: `feat/B12-identifier-scope`, `fix/<slug>`, `docs/<slug>`.
  Never commit to `main` directly. Push branches early (backup, not a
  gate).
- **Open the PR with `gh pr create` against `main`**, body: what and why,
  `Closes #nn`, the gate and e2e receipts, and any spec gap you recorded.
  Commit messages and PR bodies end with the attribution lines the session
  gives you.
- **Every PR gets reviewed by a second pair of eyes before it is called
  done.** Immediately after opening it, spawn the `pr-review` subagent
  (`.claude/agents/pr-review.md`) with the PR number. It reads the diff
  against this file and the spec, re-runs the gate at the PR head, and
  posts each finding as its own comment marked **Blocking** or
  **Non-blocking**, then a summary. **Wait for the summary.** A reviewer
  that died silently looks exactly like a clean review; no summary means
  the review did not run, and you say so rather than implying it passed.
  Then answer every comment in the thread: fix it and say so, or say why
  it is not a problem. A blocking finding is fixed or argued down before
  the PR is ready — never deferred to a follow-up unless Eric says so.
- **Stop after two rounds on one finding.** If a fix for a review finding
  has itself been found wrong twice, stop fixing it in the PR: revert to
  the behaviour at `main`, open an issue that quotes the finding, and say so
  in the thread. Three regressions on a non-blocking finding is how the
  parser's recovery once cost more than the feature it was in.
- **Merging.** This is high-speed development with no production impact
  until v1.0, so **the coding agent may merge its own PR** when all of
  these hold: the reviewer posted its summary; every blocking finding is
  resolved in the thread (fixed, or the reviewer agreed it is not one);
  the receipts in the body are at the PR's final head; and the PR closes
  or references its issue. Merge with
  `gh pr merge <n> --squash --delete-branch`, then close the issue if the
  merge did not, and label the dependents `ready`. If any condition is unmet or you are unsure,
  **assign the PR to Eric** (`gh pr edit <n> --add-assignee ericeslinger`)
  and stop; an assigned PR means "ready for your eyes", so never assign
  one that is still moving. Eric can revoke agent merging by editing
  this paragraph; until v1.0 that is the only gate on it.
- **Prefer independent PRs off `main`.** A stacked PR merges into its base
  branch, and GitHub retargets the next one at `main` only when that base
  is deleted after its own merge; if a stack is unavoidable, say so on
  every PR in it and verify afterwards with
  `git merge-base --is-ancestor <branch> origin/main`.
- Releases are Eric's: `release.yml` is manual (`workflow_dispatch`) and
  publishes with changesets. Do not add a changeset to a PR unless the
  issue says the change is user-visible in a published package.

## Invariants the reviewer checks

- The spec wins. A PR that implements something the spec forbids, or
  quietly resolves something the spec leaves open, is blocking.
- No silent outcomes: every visitor action prints something, every refusal
  has text, every fault is told. A code path that can end a turn with
  nothing to say is blocking.
- Exact typing: no `any` at a language boundary, no read through the
  object type without `is()` narrowing, no runtime "unknown receiver".
- Limits are the host's: no numeric limit hard-coded where the spec says
  it is a host default.
- Determinism: nothing a turn does may read the clock, the filesystem or
  the network; the only time is `elapsed`, and every draw comes from the
  turn's seed.
- One write rule: only `self` writes `self`; the containment tree is the
  engine's and moves through consent.
- Layout and comments as above: a file in the wrong layer, an import
  downward, a class where a context would do, or a comment that narrates
  history is a non-blocking finding that is fixed before merge.
- Diagnostics name a line and column and tell a non-programmer what to
  write instead, and a new refusal has a `corpus/bad` world pinning its
  words.
