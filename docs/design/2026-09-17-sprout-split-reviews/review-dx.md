# Outside review — developer experience, API ergonomics, adoption

Reviewer's stance: I am the second host. Say a Next.js app on Postgres who
wants rooms in a community site, and a weekend contributor who wants to add a
`sprout-store-sqlite`. I have read `design/proposals/2026-09-17-sprout-split.md`,
`packages/sprout/README.md`, the manifests, and the two Angular files that are
the only working example of a client. I have not seen the reasoning that
produced any of it, which is the point.

The design is unusually good on the parts that are hard — source-as-truth
(§3.2) is the right call and the argument for it is the best paragraph in the
document; "an extension records an effect, never performs one" (§3.5) is a real
invariant and not a slogan; per-microworld serialization with a savepoint (§4.5)
is the correct contract. What follows is where it fails an outside reader, and
most of the failures are the same failure: **the document specifies the seams
and omits the surface.** There is no line of code in it that a host could run.

---

## 1. MUST-CHANGE — §4.2, §4.4: there is no constructor. A host cannot make a runtime.

**Claim.** The single most important function in the package — the one that
turns "I installed four packages" into "I have an object with `.turn()` on it"
— does not appear anywhere in the document.

**Evidence.** §4.2 gives `TurnRequest` and `TurnResponse` as *types* and never
gives the signature that consumes them. §4.4 lists ten bare function names
(`createMicroworld(id, …, now)`, `publish(microworldId, now)`) with no receiver.
§7.1 writes `core.publish(microworld, now)` and `core.sweep(microworld, now)`,
so there is evidently an instance called `core`, and nothing says how it is
built or how the store (§4.6) and the language instance with its extensions
(§3.5, `sprout({ extensions: [media] })`) are threaded into it. Compare the
current README, which opens with a runnable `compileSprout(source, { rooms, … })`
block — that is why the existing package reads as usable and this document does
not. The hour test fails at minute one.

**Alternative.** Put this at the top of §4, and put the same block in
core's README:

```ts
import { sprout } from '@overstory/sprout-lang';
import { createRuntime, memoryStore } from '@overstory/sprout-core';
import { media } from '@overstory/sprout-ext-media';

const runtime = createRuntime({
  lang: sprout({ extensions: [media] }),
  store: memoryStore(),          // or sqlStore({ query }) / documentStore(backend)
  limits: { rooms: 32 },         // §4.4 defaults otherwise
});

await runtime.createMicroworld('demo', { entry: 'cellar' }, new Date());
await runtime.saveDraft('demo', 'cellar.sprout', source, new Date());
await runtime.publish('demo', new Date());
const res = await runtime.turn({
  microworldId: 'demo',
  actor: { id: 'u1', name: 'Marta' },
  input: { kind: 'enter' },
  now: new Date(),
});
```

Every other §4 signature is then a method on `runtime` and reads unambiguously.

---

## 2. MUST-CHANGE — §4.2: `affordances` does not close the loop with `TurnInput.command`. The chip client cannot be written.

**Claim.** The document asserts "a chip's click is a `command` input" and
"the chip client and the typing client are the same client with a different
keyboard." Neither is true of the shapes given: there is no path from anything
in `affordances` to a `Command`.

**Evidence.** `affordances: { verbs: string[]; nouns: string[]; completions:
string[] }`. `verbs` is described as "the grammar lines open right now with
slots as ellipses" — display strings. `Command` is described only as "the same
Command the parser would produce", which is a message name bound to an object id
and arguments. Nothing in the response carries object ids alongside verbs, so a
chip client must either re-parse the ellipsis string (re-implementing the
parser on the client — the thing §3.1 moved into core precisely so it would not
be duplicated) or fall back to sending text, at which point `command` is dead
weight. This is a **regression from what ships today**:
`room-view.component.ts:61,87` sends `{ itemId, verb }`, because
`ItemView.verbs` scopes each verb to its item (`packages/schema/src/understory.ts`,
`RoomView.verbs` for the room plus `ItemView.verbs` per item). §4.2's flat
`verbs: string[]` throws that association away.

Second half, worse: a `command` arriving from a client is **untrusted input in
the shape of a parser output**, and §4.2 never says core re-validates it against
the scene. A client that posts `{ kind:'command', command: { target: 'vault',
message: 'open' } }` names an object it cannot reach. The parser is where reach
is enforced; the `command` input walks around it.

Third: making `Command` a wire type makes it a public, versioned format that
crosses a network and gets logged into `sprout_action`. That is the identical
objection §3.2 raises against a persisted AST, and it goes unanswered.

**Alternative.** Make affordances carry the commands, and make the input carry
only what core minted:

```ts
affordances: {
  actions: { label: string; token: string }[];   // "light the torch with …", opaque
  nouns:   { label: string; token: string }[];
  completions: string[];
}
type TurnInput =
  | …
  | { kind: 'chip'; token: string; args?: string[] };   // tokens from THIS scene
```

`token` is minted by core for the scene it just described and resolved by core
against the scene it loads; it is opaque to every client, so no parser internal
crosses the wire and no id can be forged. If you keep a structured `Command`
instead, §4.2 must state that core re-runs the reach and `when`-guard checks on
it, in the same words it states them for `say`.

---

## 3. MUST-CHANGE — §4.2 vs §7.1: `complete` is a turn in one section and not a turn in the next.

**Claim.** The document contradicts itself, and the resolution it half-reaches
in §7.1 is the right one.

**Evidence.** §4.2 lists `{ kind: 'complete'; prefix: string }` as a
`TurnInput`, so it returns a `TurnResponse`: `lines`, `scene`, `effects`,
`moved`, `missed`, `faulted`. §7.1 then says "`completeUnderstory` stays its own
[callable] (it is not a turn and should not take the lock)." Both cannot hold —
if `complete` is a `TurnInput`, the Understory's own callable is calling
something else, and the "one entry point" claim is already false at the first
host. `forget` has the same smell for a different reason: it is a mutation, but
its answer is a whole scene and a transcript, which is how you get today's
`resetUnderstoryMemory` returning a `RoomView` (`understory.page.ts:325`). A
host writing a settings screen wants `forget` without a scene.

**Alternative.** Three methods, honestly named, and `lines`/`scene` only where
they mean something:

```ts
runtime.turn(req: TurnRequest): Promise<TurnResponse>      // enter, look, say, chip, leave
runtime.complete(q: { microworldId; actor; realm?; prefix; now }): Promise<{ completions: string[] }>
runtime.forget(q: { microworldId; actorId; now }): Promise<void>
```

`complete` and `look` then also justify finding 9's read path.

---

## 4. SHOULD-CHANGE — §4.2: `lines` / `scene` / `effects` / three booleans is four representations of one turn, and a client must guess which is authoritative.

**Claim.** The factoring double-counts. A naive client renders every effect
twice; a careful one has to be told which channel wins, and the document does
not tell it.

**Evidence.** `TranscriptLine` has `kind: 'effect'` with an `effect?: Effect`
field, *and* `TurnResponse` has a top-level `effects: Effect[]`. Today's page
maps `r.shown` into picture lines (`understory.page.ts:236`) — with both
channels present it will do that and also render the `'effect'` lines, and a
lightbox opens twice. `moved: boolean` is `scene.roomId !== previous` and the
client already computes exactly that today (`const before = this.room()?.roomId`,
line 224). `missed` and `faulted` restate `lines[].kind === 'miss' | 'fault'`.

Related and unaddressed: **`look` is the poll** (§4.2 calls it "the poll, and
the presence heartbeat", and today it fires every `UNDERSTORY_POLL_MS`), but
nothing says what `lines` a `look` returns. If it returns the room block, a
polled transcript grows a room block every few seconds. If it returns nothing,
the field is a lie for the most frequent call in the product. There is also no
etag/`sinceStamp`, so every poll ships the whole scene.

**Alternative.** Effects live in `lines` only, in order, and the top-level
`effects` is deleted (a host that wants the list does
`lines.flatMap(l => l.effect ?? [])`). The three booleans go; `scene.roomId` and
the line kinds carry it. Add `scene.stamp: string` and
`TurnRequest.knownStamp?: string`, and let a `look` whose stamp matches return
`{ lines: [], scene: null, … }` — the poll is then cheap and its contract is
written down.

---

## 5. SHOULD-CHANGE — §4.2/§7.2: `now: Date` is in the turn request, and §7.2 mirrors the turn request onto the wire.

**Claim.** As written, the clock seam crosses the network and the browser
supplies `now`.

**Evidence.** §4.2 puts `now: Date` in `TurnRequest`. §7.2: "`packages/schema/
src/understory.ts` keeps … the turn's request and response as zod — with
`TurnInput` and `TurnResponse` mirrored from core's types and pinned to them by
a spec." A spec that pins the mirror to core's type will pin `now` too, and then
a `Date` — which does not survive `JSON`/`encode()` — is a wire field the client
controls. CLAUDE.md is explicit that wall time enters "always as a `now`
PARAMETER" at a *named seam*; a callable payload is not one.

**Alternative.** Say it in §7.2 in one sentence: the wire request is
`Omit<TurnRequest, 'now' | 'actor'> & { profileId, targetProfileId }`; the
handler supplies `now` and the acting mask. And the pinning spec pins the
*input* type only, not the envelope. While there: §7.2 correctly says `realm`,
`options` and a command's `args` are `.nullish()` in the mirror — note that
`options: { keepMissText?: boolean }` is a nested optional and `actions.spec.ts`
walks at every depth (#433), so the mirror needs `keepMissText` nullish too, not
just `options`.

---

## 6. SHOULD-CHANGE — §4.3: `actor: { id, name }` is nearly right and is missing `leave`, a cap, and a collision rule.

**Claim.** Sufficient for Overstory, not for the CLI, and under-specified for
anyone.

**Evidence.** Presence is derived from `lastSeen` inside a window (§4.1, §4.3).
There is no `{ kind: 'leave' }` input, so a telnet client that disconnects —
and §6/§10.3 put `serve` in the first cut specifically to demo multiplayer —
leaves a ghost standing in the room for the whole presence window, and the other
terminal is told someone is there who is not. The browser has the same problem
on tab close; today it is hidden because the poll simply stops. Separately,
`name` is unvalidated: core writes it to `ActorRecord` every turn, and the
language caps a name at 80 characters (README "Limits") while core caps nothing.
And nothing says what happens when the same `actor.id` arrives with a different
name than the row holds, or which name `present` shows for an actor who has not
taken a turn since renaming.

**Alternative.** Add `{ kind: 'leave' }` to `TurnInput` (it is a real turn: it
writes the actor row and can produce a `left` line for others); cap `name` at
the language's name cap and say core truncates rather than throws; and state in
§4.3 that `present` reports the last name each actor supplied, which is why a
host that has better names (Overstory) re-decorates by id.

---

## 7. MUST-CHANGE — §3.5: the extension API is not something a third party can write against. Four of its five fields are undefined.

**Claim.** §3.5 is a sketch of a good idea presented as an interface. Every
type an extension author would program against is missing or elided.

**Evidence, field by field:**

- `shape: 'target? symbol?' | 'string' | 'target symbol string' | …` — a
  string mini-DSL, closed ("a fixed menu of shapes the hand-written parser
  knows"), and the menu ends in an ellipsis. A third party cannot enumerate it,
  cannot extend it, and cannot tell whether their statement is expressible.
- `ReadOnlyFrame` — named once, defined nowhere. It is the *entire* API an
  extension body programs against.
- `Effect` — `transcript?: Record<string, (effect) => string>` has an
  implicitly-`any` parameter in the document's own snippet. There is no
  `Effect` type, no per-extension discriminant beyond the `{ extension, kind }`
  in the prose example, and no schema — yet §7.1 says the Understory passes
  effect ids to `signMedia`, i.e. effects cross a wire and must be validated.
- **No compile-time hook at all.** Today the compiler checks `show self
  :blueprint` names a media property. With only `run(ctx, args)`, that check
  has nowhere to live and moves to runtime — which contradicts §3.2's "every
  check runs at save, as now."
- **No printer hook.** §3.2 makes the printer load-bearing (it round-trips
  source, it is the migration path for a syntax break, `sprout check` uses it).
  An extension statement in a unit must print back; `transcript` renders for
  *players*, not for the printer.

**Alternative.** Make the shape data, which gives you the parser, the printer
and the completion table for free:

```ts
interface StatementSpec<A extends string = string> {
  args: { name: A; kind: 'target' | 'symbol' | 'string' | 'expr'; optional?: boolean }[];
  pure: boolean;
  check?(args: BoundArgs<A>, program: Program): Problem[];   // at save, like every other check
  run(frame: ReadOnlyFrame, args: BoundArgs<A>): Effect | void;
}
interface ReadOnlyFrame {                     // spell this out; it is the whole API
  self: ObjectRef; room: ObjectRef; container: ObjectRef | null; actor: ObjectRef;
  resolve(name: string): ObjectRef | null;
  get(ref: ObjectRef, prop: string): Value | null;
  is(ref: ObjectRef, kind: string): boolean;
}
interface SproutExtension<E extends Effect = Effect> { … transcript?: (e: E) => string; effect: ZodType<E>; }
```

`effect: ZodType<E>` also gives a host wire validation, which §7.1 needs and
does not have.

---

## 8. MUST-CHANGE — §4.6: `StoreTx` has no way to delete one object, and `destroyed` has nowhere to land.

**Claim.** A straight hole in the port, not an ergonomic quibble.

**Evidence.** The evaluator's outcome carries `destroyed: Set<string>`
(`engine.ts:170`) and §3.4 keeps it ("what was spawned and destroyed"). The
port offers `putObjects(realm, rows)` and `clearObjects(realm)` — upsert-many
and truncate. `destroy self` on one lamp cannot be expressed without rewriting
the entire object set of the microworld every turn, which is the document's own
stated worst case (2,000 rows, §4.1). `sprout_object` in §5.1 says `putObjects`
is "one `INSERT … ON CONFLICT DO UPDATE` per changed row, chunked" — no delete
there either.

**Alternative.**

```ts
putObjects(realm: Realm, change: { upsert: ObjectRecord[]; remove: string[] }): Promise<void>;
```

One call, still atomic inside the tx, and a document adapter implements it by
mutating the in-memory array before the single write.

---

## 9. SHOULD-CHANGE — §4.5/§4.6: `transaction(microworldId, fn)` is the only entry, so the poll takes the write lock.

**Claim.** The transaction shape is right — repository-per-record would be
worse, because the turn genuinely needs one lock and one atomic write, and a
repository style would force adapters to invent their own unit of work. But
making it the *only* door is what will make a second host's Postgres fall over.

**Evidence.** §4.5-1: "Turns on one microworld are serialized … locked against
every other transaction on the same microworld." §4.2 makes `look` a turn and
calls it "the poll", and the shipped client polls on an interval per visitor
(`UNDERSTORY_POLL_MS`, `understory.page.ts:276`). So N visitors in one popular
microworld take the same `FOR UPDATE` row lock every few seconds, each loading
all 2,000 objects, and they queue. `complete` (finding 3) is the same shape.
The document notices the cost exactly once — §7.1's "it should not take the
lock" — and never puts a read path in the port.

**Alternative.** Add a second, contractually read-only entry and say the
adapter may implement it without locking:

```ts
interface SproutStore {
  transaction<T>(microworldId: string, fn: (tx: StoreTx) => Promise<T>): Promise<T>;
  read<T>(microworldId: string, fn: (tx: ReadTx) => Promise<T>): Promise<T>;   // ReadTx = the getters only
}
```

`look`-without-heartbeat and `complete` go through `read`; the heartbeat becomes
a fire-and-forget `putActor` or is batched. The conformance suite gains one
case: a `read` during a `transaction` does not deadlock.

---

## 10. SHOULD-CHANGE — §4.6: "small enough to implement on localStorage in an afternoon" does not survive counting.

**Claim.** The port is 20 methods over 8 record types that are never specified,
plus two of them are real query work.

**Evidence.** Count `StoreTx`: 20 methods. Count the types they mention:
`MicroworldRecord`, `UnitRecord`, `VersionRecord`, `ObjectRecord`,
`ActorRecord`, `MemoryRecord`, `ActionRecord`, `MissRecord`, `Realm` — nine,
none defined anywhere in the document, and an adapter author must serialize
every one. Two methods are not round-trips: `actorsIn(realm, room, since)` is a
three-predicate filter, and `trim(before, keepMisses)` pushes *retention policy*
(keep the newest N misses — an order-by-limit) into every adapter, where each
one will get it subtly differently. `actions(opts)` and `misses(opts)` take an
unspecified `opts`.

**Alternative.** Two ports, so the floor is genuinely low:

```ts
interface SproutStore  { transaction(…); read(…); }        // the 12 methods a turn needs
interface SproutLogStore { appendAction; actions; appendMiss; misses; }   // optional
```

Core implements `trim` *over* the log port (read, sort, delete) with a
`trimNative?` fast path an adapter may override; `actorsIn` becomes
`actors(realm)` filtered in core (an actor list is bounded by the presence
window and small). Then the localStorage adapter is six methods and the claim
in §0's table is true. Publish the nine record types as zod schemas in core
while you are there — an adapter author needs them, and store-document needs
them to validate what it read back out of a JSON blob.

---

## 11. MUST-CHANGE — §2: six packages with no peer-dependency story; two copies of lang silently break the extension registry.

**Claim.** The dependency graph as drawn will produce duplicate-install bugs
that are invisible until an extension statement mysteriously fails to compile.

**Evidence.** §2's table: core depends on lang; `ext-media` depends on lang;
the CLI depends on core, store-sql, ext-media. §3.5 registers extensions on a
**language instance** (`sprout({ extensions: [media] })`), and a host constructs
that instance, so the host also depends on lang directly. That is four packages
naming lang. Every one of them will carry an exact pin (this repo pins runtime
deps exactly, and CLAUDE.md says why). The moment core pins `lang@0.2.0` and a
host pins `lang@0.2.1`, npm installs two copies, and anything the registry does
by identity — a keyword set, a built-in kind table, an `instanceof` — diverges
between the `media` object the host built and the lang core is calling. Nothing
in the document says `peerDependencies` anywhere.

Second: hello world is four installs. `npm i @overstory/sprout-lang
@overstory/sprout-core @overstory/sprout-store-sql
@overstory/sprout-ext-media` is a worse first line than any competitor's.

**Alternative.** lang is a `peerDependency` of core and of every extension
(with a `devDependency` for their own tests); the conformance/extension spec
asserts a single resolved copy at runtime (`lang.VERSION` identity check with a
named error). And ship a batteries-included entry — the scope makes it free,
since `sprout` is only taken *unscoped*:

```
npm i @overstory/sprout        # re-exports lang + core + memoryStore; the README's first line
npm i @overstory/sprout-store-sql   # when you have a database
```

Six publishable packages is fine. Six *installs to say hello* is not.

---

## 12. MUST-CHANGE — §2, §9.4: versioning across the six packages is unspecified, and the language version is conflated with a package version.

**Claim.** The document's only statement about versions is "publish 0.1.0 of
each package." A host cannot answer "what do I pin?" and core cannot answer
"is this microworld too new?" without a rule that is not written.

**Evidence.** §3.2 states a real runtime check: "A microworld records the lang
version that last compiled it; core refuses to load a microworld compiled by a
*newer* lang than itself." So a version string is written into
`sprout_microworld` on every publish. If that string is lang's npm version, then
(a) a patch release rewrites rows with no semantic change, (b) a host who rolls
back a patch bricks every microworld published since, and (c) the comparison is
semver, in core, for a *language* property. Meanwhile §2 has six packages whose
compatibility matrix is never stated: does `ext-media@0.3` work against
`lang@0.2`? Does core pin lang or peer it (finding 11)? §9 stage 4 has no
release tooling — no changesets, no lockstep policy, no `0.x` caveat for hosts,
and no statement of what "0.1.0" promises.

**Alternative.** Two versions, both explicit:

```ts
// lang
export const LANGUAGE_VERSION = 1;   // an integer, bumped ONLY when syntax is added
```

recorded on the microworld; core's rule becomes
`if (record.language > LANGUAGE_VERSION) throw new SproutError('language-too-new')`,
which is a comparison of integers and survives every package release. And
publish all six **in lockstep from one version number** (changesets with a
`fixed` group, or a single `version` field the release script stamps), because
the repo is one repo and the seam is admittedly moving — then §2's host guidance
is one line: *"pin all `@overstory/sprout-*` to the same exact version;
they are released together."* Add that line to §2 and a "Releases" subsection to
§9 stage 4.

---

## 13. MUST-CHANGE — §2 vs §7.4 vs §9.4: `examples/` is unpublished, and the build order depends on Overstory reading it after the split-out.

**Claim.** A concrete broken step, not a preference.

**Evidence.** §2: "`examples/` … **Not published**; the CLI's and the README's
material, **and what Overstory's seed reads**." §7.4: "`seed-understory.ts`
becomes 'read `examples/*.sprout`, `importMicroworld`, `publish`'." §9 stage 4:
the `examples/` path is *split out of this repo* into
`overstory-social/sprout` and Overstory "deletes the directories". After stage 4
the files Overstory's seed reads are neither in its tree nor on npm. The
`schema` job (`npm run schema:check`, which runs the seed) fails on the split-out
PR.

Separately, on adoption: the pottery studio *is* the demo. A host who liked
`sprout play examples/pottery-studio` wants `importMicroworld` of that same
world into their own app, and "clone the repo and copy two files" is the answer
the document gives them.

**Alternative.** Publish it — it is text files and a manifest:

```jsonc
// @overstory/sprout-examples
{ "exports": { "./pottery-studio": "./pottery-studio/*.sprout", "./manifest.json": "./manifest.json" } }
```

with `loadExample(name): { name, source }[]` so Overstory's seed and a host's
tutorial read it the same way. If you genuinely want it unpublished, then §7.4
must say Overstory vendors the two `.sprout` files into `packages/e2e/` at stage
4, and §9.4 must list that as a step.

---

## 14. SHOULD-CHANGE — §1: `realm` is the wrong word and is two different types wearing one name; `unit` collides with the test vocabulary.

**Claim.** The glossary is better than most — `microworld`, `scene`,
`definition`, `program`, `host` all land, and keeping `instance` for the
language is right. Two words do not land, and one of them has a typing bug.

**Evidence.** `realm` reads as tenancy/security to anyone who has met Keycloak,
Kerberos or Minecraft; what it means here is "which copy of the state". Worse,
it is two types: §4.2 exposes `realm?: 'live' | 'draft'` to the caller, while
§4.1/§4.6 use `Realm` = `'live' | 'draft:<actorId>'` — a string with structure
encoded in it, no parser exported, and every adapter author will write their own
`split(':')`. `unit` (§1: "a piece of source: one file in the CLI") is
unfortunate in a repo whose CLAUDE.md says "unit specs" six times — "the unit
spec for the unit loader" is a sentence someone will write this month. And
`microworldId` appears in every signature in §4 and §5; ten characters of prose
value in a parameter name used a hundred times.

**Alternative.** `realm` → `stage` or `branch`; whichever you pick, make it a
value, not a string with a delimiter:

```ts
type Realm = { live: true } | { live: false; draftOf: string };
export function realmKey(r: Realm): string;   // adapters key on this, and only this
```

`unit` → `file` (the CLI has files; the editor page is a file with a virtual
name) or `module`. And consider `worldId`/`sprout.turn({ worldId })` on the API
surface with *microworld* as the prose word — `SproutWorld` is being freed by
the rename to `Scene`, so `world` is available and the document's own sentences
("the unit core loads") read fine either way.

---

## 15. SHOULD-CHANGE — §6, §9.3: `serve` is billed as "the demo of the multi-actor claim" and, as specified, demonstrates nothing.

**Claim.** The turn API is request/response with no push, and §9.5 defers the
only mechanism that would make two terminals interesting.

**Evidence.** §6: "telnet in from two terminals and give each other things.
Multiplayer without a browser; the demo of the multi-actor claim." §9.5, in the
*later, not needed* list: "narration to other actors in a room (the per-actor
inbox understory.md §10.3-5 deferred)." So terminal A takes the cup; terminal B
sees nothing at all until its human types `look`. The web client hides this with
a poll; a telnet session has no poll and no reason to have one. A reviewer
trying the headline demo gets a shared database, not multiplayer.

Smaller CLI points, all cheap: `.sprout/` as the state directory sits beside
`*.sprout` as the source glob — `*.sprout` matches a directory in plain shell
globbing and in several JS globbers, so `sprout check` will try to compile its
own database directory; call it `.sprout-state/` or put the db at
`.sprout/db`. There is no `sprout init` (a host's literal first command). There
is no `--json` on `check`, which is what an editor extension and a CI step both
want, and §3.3's `Problem = { unit, line, column, message }` is already exactly
the right JSON.

**Alternative.** Either land the per-actor inbox with `serve` in stage 3 — the
actor row is where it lives (§9.5 says so) and the shape is small:
`TurnResponse.lines` gains lines drained from the actor's inbox on every turn,
and `serve` drains on a timer per connection — or change §6's sentence to what
`serve` actually proves ("two people in one world, each seeing the other's
changes on their next look") so nobody is sold the wrong thing. Add `init`,
`--json`, and rename the state directory.

---

## 16. SHOULD-CHANGE — §4.4: `MicroworldExport` is a persisted public format, unversioned — §3.2's own argument applies to it.

**Claim.** The document wins its best argument and then reintroduces the same
problem one level up without noticing.

**Evidence.** §3.2: "a stored AST is a public, frozen format … A language that
is meant to be embedded by other hosts cannot ask every host's database to
follow its internal tree." §4.4 then gives
`exportMicroworld(microworldId): MicroworldExport; importMicroworld(export, now)`,
described in §1/§4.4 as "takeout, the CLI's directory, a copy between hosts."
§7.1 writes it into `takeoutExtras`, i.e. into a file a user downloads and may
re-import a year later, against a different version, possibly on a different
host. That is precisely a stored, public, cross-version format — and unlike the
AST, this one is *designed* to be persisted. It has no version field, no
documented shape, and no statement of what a host may assume across versions.

**Alternative.** Give it a version and say the rule out loud in §3.2, so the
list of persisted public formats is closed and short:

```ts
interface MicroworldExport {
  format: 1;                 // the ONLY persisted format number in the system
  language: number;          // LANGUAGE_VERSION at export
  units: { name: string; source: string; versions: { n: number; source: string; at: string }[] }[];
  objects?: …; actors?: never;   // state is optional; identities never travel
}
```

and add to §3.2's bullets: *"Two formats are persisted and public: Sprout source
and the export envelope. Everything else — the AST, `Command`, the store's
records — is internal and may change in a minor version."* That sentence is the
one a second host most needs.

---

## 17. SHOULD-CHANGE — errors: there is no error taxonomy, and §4 uses two error styles in one API.

**Claim.** Every host will string-match on messages, because nothing else is
offered.

**Evidence.** The document never names an error type. §4.2 lists failure modes
in prose ("refuse a newer language version", "the door for `enter`"), §4.4 says
`publish` "refuses if it does not compile" while `saveDraft(…): Problems`
*returns* its refusal and `checkDraft` returns `{ problems, warnings }` — so
compile failures are values in two places and an exception in a third. §4.4's
limits ("rooms and objects per microworld", "2,000 live objects") must fail
somehow and the document does not say how. The existing client's answer to all
of this is `errorSentence(err)` and re-enter (`understory.page.ts:243, 385`),
which works only because the Firebase callable layer supplies codes.

**Alternative.**

```ts
export class SproutError extends Error {
  code: 'no-such-microworld' | 'language-too-new' | 'not-published' | 'limit-exceeded'
      | 'compile-refused' | 'no-such-extension' | 'faulted';
  detail?: { limit?: string; problems?: Problem[] };
}
```

and one rule stated in §4: *compile outcomes are always returned as `problems`,
never thrown; everything else throws `SproutError`.* Then `publish` returns
`{ minted: string[]; problems: Problem[] }` and stops being the odd one out.

---

## 18. SHOULD-CHANGE — §4.6, §9: the testing story for a host is one sentence, and the sentence has a packaging problem.

**Claim.** "The conformance suite is one vitest file in core, exported" makes a
test framework a public dependency of a runtime package, and it is the *only*
testing affordance offered to a host.

**Evidence.** §4.6. If the file is exported from `@overstory/sprout-core`,
either vitest is a dependency of core (it ships to production; CLAUDE.md is
emphatic about what may sit in a runtime manifest and why — the 2026-09-03
arborist incident) or it is an unlisted peer and the import fails for a host on
jest, node:test, or bun. Separately: nothing is offered for a host's *own*
tests beyond `memoryStore()`. There is no fixture, no way to build a world in
three lines, and no way to assert on a turn except substring-matching
narration — so every host will write the same 40-line setup, and the README will
not show it.

**Alternative.** Ship the suite assertion-library-free from a subpath, and add
one fixture helper:

```ts
// @overstory/sprout-core/conformance   (no test framework imported)
export const cases: { name: string; run(makeStore: () => SproutStore): Promise<void> }[];
// a host: for (const c of cases) it(c.name, () => c.run(mine));

// @overstory/sprout-core/testing
export function testWorld(sources: string[]): {
  runtime: Runtime;
  play(line: string, as?: string): Promise<TurnResponse>;   // enter implied
};
```

`testWorld` is ten lines and it is what makes the README's "try it" believable.

---

## 19. NOTE — MIT plus `private: true` until stage 4 is coherent; the *provenance* around it is not yet.

**Claim.** The staging is right and I would not change it. Three loose ends.

**Evidence.** `packages/sprout/package.json` is already
`"license": "MIT", "private": true`, which is exactly the shape — MIT is a
promise made now, `private` stops an accidental publish. But: there is **no
`LICENSE` file anywhere in the repo** (`ls LICENSE*` finds nothing, and
`packages/sprout/package.json` lists `"LICENSE"` in `files`, so the published
tarball will be missing a file it claims). §9 stage 4 does `git subtree split`
**with history** into a public repo, which publishes every commit message and
co-author line written while the code lived in a private product repo — worth a
deliberate look, once, before the push, not after. And the current README's
"the design history is `sprout.md` at the repository root" becomes a dangling
reference the moment lang is published; `sprout.md` and `understory.md` are
Overstory product documents and mostly should not travel.

**Alternative.** Add `packages/sprout/LICENSE` now (and one per package at the
split); add to §9 stage 4: "review the history being published; decide which of
`sprout.md` goes to the public repo as `docs/design.md` and what stays."

---

## 20. SHOULD-CHANGE — §8, §9: the documentation debt this creates is large and is not on the plan.

**Claim.** §8 lists thirteen calls for the record and zero documents to change;
§9's five stages list proof obligations and no prose obligations. Given how much
of this design *is* prose, that is the omission most likely to be paid late.

**Evidence, what goes stale, concretely:**

- `packages/sprout/README.md` — 720 lines, and its last four sections are
  wrong after stage 1: "The definition format" describes `format: 2`,
  `upgradeSproutDefinition` and "a definition carries the source it was compiled
  from" (all deleted by §3.2); "Embedding the engine" describes `SproutWorld`
  (renamed) and `describeWith`; "Using the package" shows `compileSprout(source,
  { rooms, zoneMessages })` (replaced by `compileMicroworld`); "Pictures" and
  the `:image` rows in three tables move to ext-media. And there is no README at
  all for core, the two adapters, ext-media or the CLI — five to write.
- `sprout.md` §4 (amended by §3.2), §2.9 (media leaves the language), §2.11 and
  §5 (the parser moves packages), §6/§7 (the v0 migration and build order are
  spent).
- `understory.md` §10.3–§10.6 describe the v0 architecture being deleted.
- **`CLAUDE.md`'s invariant** — "`@overstory/sprout` is the Sprout language and
  imports nothing but zod … its `boundary.spec.ts` fails the gate on the first
  foreign import" — is wrong at **stage 1**, not stage 4: there are six packages
  with six different allowlists (store-sql imports `pg` types, the CLI imports
  PGlite, core imports lang). Also `boundary.spec.ts` as written does
  `readdirSync(SRC)` over one flat directory and will silently check nothing in
  core's subdirectories.
- `skills/sprout/SKILL.md` becomes per-host output (§3.6) — `npm run
  sprout:skill` and `scripts/sprout-skill.mjs` need to say which extension set
  they render.
- `packages/e2e/areas.mjs` — §9.4 mentions the glob; the area map also needs a
  glob per new `packages/sprout-*` directory at stages 1–3, or an unmapped path
  runs every journey (CLAUDE.md).

**Alternative.** Add a **docs column to §9's stage table** naming what each
stage must leave true, with CLAUDE.md's invariant paragraph explicitly in stage
1 and the six READMEs in stage 4, and add a fourteenth entry to §8: *"the
language README splits: the language to lang, embedding to core, pictures to
ext-media."*

---

## Verdict

This is a strong architecture document and a weak API document, and the split
it proposes will succeed or fail on the second thing. The calls that are hard to
reverse are all made well: source-as-truth kills a stored format before it can
metastasize; extensions-record-effects keeps the language total under third-party
code; one repo with six packages is right for a seam that will move three times;
per-microworld serialization with a savepoint is the contract all three backends
can actually honour. But nothing in the eight hundred lines is a program a host
could run — there is no constructor (1), the chip loop does not close (2),
`complete` is a turn in §4.2 and not a turn in §7.1 (3), the extension interface
leaves `ReadOnlyFrame`, the `shape` menu and `Effect` undefined (7), the store
port cannot delete an object (8) and takes the write lock on every poll (9), and
the questions a host asks on day two — what do I pin, how do I test, where is
the world I just played — have no answers (11, 12, 13, 18). None of this is
deep: eleven of the twenty findings are discharged by writing the ten lines of
TypeScript that are currently described in prose, and doing it *before* stage 2,
because stage 2 is where the seam is proven and a seam nobody outside can see is
not proven. I would take one focused revision — §4 opens with a runnable
embedding, §3.5 gets real types, the port gets `read` and a delete, §2 gets a
versioning and peer-dependency paragraph — and then this is a design I would
build a host against.
