# Sprout — house rules

Sprout is a language for small multiplayer interactive-fiction worlds, and
the runtime that hosts them. It is **unreleased and mid-rewrite**: the code
under `sprout/` and `cli/` implements the _previous_ language, and the
design under `docs/design/` describes the one being built. Until the
rewrite lands, the code is not the authority on what Sprout is.

Orientation: `README.md` (layout + commands);
`docs/design/sprout-design-spec.md` (**the language as it is to be built —
where anything disagrees with it, the spec wins**);
`docs/design/sprout-working-notes.md` (the reasoning behind the spec, its
_Decisions_ and its _Holes_); `docs/design/sprout-build-backlog.md` (53
numbered items, one GitHub issue each — item B*nn* is issue #_nn_; #54 is
the tracking issue and the build order); `docs/design/2026-09-20-reviews/`
(the five critiques the spec was revised against). Older files under
`docs/design/` are dated and superseded.

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
  in the PR and add a line to the notes' _Holes in the spec_ — never invent
  quietly. Do not edit the spec to match code; propose the change in the
  PR and let Eric decide.
- **Replace, do not retrofit.** The old implementation is a source of
  ideas and of test shapes, not a constraint. Where it disagrees with the
  spec, delete it. Keep what still holds — the store conformance suites and
  the extension boundary are largely language-agnostic.
- **Every source file has a colocated spec** (`foo.ts` → `foo.spec.ts`) that
  exercises it directly; coverage through another file's spec does not
  count. Vitest strips types, so `typecheck:spec` in the gate is what
  catches a type error in a spec.

## The legacy fence

Most of the existing suites, the corpus and the two example worlds
describe the previous language, and they will fail — correctly — as the
rewrite lands. The rule keeps the gate green without lying:

- A suite, corpus entry or example that fails **because your change makes
  it describe a language that no longer exists** is moved, in the same PR,
  under a `legacy/` directory beside it: `sprout/lang/src/legacy/`,
  `corpus/legacy/good/…`, `sprout/examples/legacy/…`. `vitest` excludes
  `**/legacy/**`; `check-corpus` reads only `corpus/good` and `corpus/bad`.
  Say in the PR what you fenced and which issue deletes it.
- A suite that fails **because your change is wrong** is fixed before
  commit. The difference is yours to argue in the PR, and the reviewer's
  to check.
- **The issue that replaces a legacy thing deletes it.** `legacy/` is a
  holding pen, not an archive; git remembers.
- What must never be fenced: a spec for code you touched, the store
  conformance suites, the boundary specs.

## The gate, locally

There is **no CI**. GitHub minutes are not spent on this repository until
it is stable; every check runs on the machine of whoever is committing,
and a PR carries the evidence.

- **`npm run gate` before every commit** — lint, prettier, both builds,
  every suite, the spec typechecks, `sprout check` over the corpus and the
  examples. Green, or the commit does not happen. A red you believe is a
  legacy failure is fenced (above), not ignored.
- **`npm run e2e` before opening a PR** — packs both tarballs, installs
  them into an empty folder, and checks and plays an example world from
  the installed CLI. This is the end-to-end test until B49 (the worked
  microworld as a fixture, with golden transcripts) replaces it; when the
  example worlds are fenced, `scripts/e2e.sh` follows them and B49 is the
  new e2e.
- **The PR body carries the receipts**: the short sha the gate ran at, its
  last line, and the same for e2e. A reviewer re-runs the gate at the PR
  head in a worktree; a PR without receipts is not ready.

## Branches, PRs, review, merge

- `main` is the integration head. **All work happens on a branch** cut
  from `main`: `feat/B12-identifier-scope`, `fix/<slug>`, `docs/<slug>`.
  Never commit to `main` directly. Push branches early (backup, not a
  gate).
- **Open the PR with `gh pr create` against `main`**, body: what and why,
  `Closes #nn`, the gate and e2e receipts, what was fenced, and any spec
  gap you recorded. Commit messages and PR bodies end with the attribution
  lines the session gives you.
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
- A moved or fenced suite is named in the PR; a deleted suite is deleted by
  the issue that replaced it, not by the one that broke it.
- Diagnostics name a line and column and tell a non-programmer what to
  write instead.
