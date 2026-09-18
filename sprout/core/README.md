# @overstory/sprout-core

The Sprout runtime: **load** a microworld from an archive, then **turn**.
Core plays what a host hands it and holds runtime state only — objects,
actors, memory, the action log. It has no authoring surface (drafts,
versions, publishing and schedules are the host's; a builder's draft is
just another microworld under an id the host chooses), and it knows no
identity (an actor is an id and a name the host supplies each turn).

MIT. Imports the language (`@overstory/sprout`) and zod, and nothing
else; the store is a port an adapter fills.

## An embedding, in twelve lines

```ts
import { createRuntime, memoryStore } from '@overstory/sprout-core';
import { MEDIA } from '@overstory/sprout-ext-media';

const runtime = createRuntime({
  store: memoryStore(), // or an adapter: sqlStore({ client }), documentStore(backend)
  ext: MEDIA, // what a `use` line may name
  limits: { rooms: 32 }, // defaults otherwise
});

await runtime.load('demo', archive, now); // files + manifest; compiled leniently, unfolded into the store
const res = await runtime.turn({
  microworldId: 'demo',
  actor: { id: 'u1', name: 'marta' },
  input: { kind: 'enter' },
  now,
});
// res.lines — what happened, in order; res.scene — the room as they see it; res.affordances — chips
```

Errors are one class with codes — `SproutError` with `code` in
`no-such-microworld | language-too-new | not-loaded | limit-exceeded |
no-such-extension | duplicate-name` — and one rule: **compile outcomes
are returned as `absent` and `warnings`, never thrown; everything else
throws `SproutError`.** A fault is neither: it is a turn's outcome, a
`fault` line on an ordinary answer.

## The turn

One entry point for playing, and two small ones beside it:

```ts
runtime.turn(req: TurnRequest): Promise<TurnResponse>
runtime.complete({ microworldId, actor, prefix, now }): Promise<{ completions }>
runtime.forget({ microworldId, actorId, now }): Promise<void>
```

`TurnInput` is `enter` (the door, or back where they stood), `look` (the
poll and the presence heartbeat — a **read** turn: no write lock, no
action row), `say` (a typed line — the universal input), `chip` (a
token core minted for _this_ scene) or `leave`. The response is
`lines` — pending notices from other actors, then what happened, each a
`said | room | question | miss | refused | fault | notice | effect`
line — `scene` (null when the request's `knownStamp` matched: nothing
changed) and `affordances`: chips and nouns, each with a **token**
minted for the scene it describes and resolved against the scene core
loads next; a stale or forged token is a `refused` line, and nothing of
the parser crosses the wire. Effects live in `lines` and nowhere else.

Inside a write turn, in order: the microworld record; the program from
the cache or a lenient compile of the stored archive; the store's write
transaction on the microworld; the actor's row, or the door for
`enter`; the scene from the object rows; drain `pending`; for `say`,
the matcher against the scene, the open exits and the people present;
for `chip`, the token resolved; the evaluator; the outcome applied to
rows; notices queued to the others in the room; the action appended;
the actor's narration and last noun written; the answer projected. A
fault writes nothing of the world: the object rows are never issued,
only its action record (with the chain) and the actor's own row land.
A miss appends an action with `missed`; its text is kept only when the
turn says `keepMissText`.

## Actors, presence, and the lines others read

Core does not know who an actor is. Each turn brings an id and a name;
the name is a stable, host-unique token (Overstory supplies a handle,
never a display name), capped at the language's name cap. Nothing else
about an actor exists in core — `boundary.spec.ts` fails on a new field
in `ActorRecord`. When a write turn moves an actor into or out of a
room, core queues a `notice` line to every other actor present, drained
into their next turn's `lines`: two terminals on one microworld are a
shared world, not a shared database.

## Loading, resetting, inspecting

```ts
load(microworldId, archive, now, { limits? }): LoadReport  // compile leniently, unfold, keep state that still fits
reset(microworldId, now)          // back to the archive's initial state; memory untouched
destroyMicroworld(microworldId, now)
inspect(microworldId, 'owner' | 'operator', now): MicroworldReport   // two projections, redaction in core
snapshot(microworldId, objectId)  // an object's live state — a flag's live half
forgetActor(actorId, now); exportActor(actorId)   // across every microworld: wipeout and takeout
trim(now)                         // housekeeping; not a turn
```

`load` is the one door for content: a first load creates the microworld;
a later one replaces its archive and keeps its actors, memory and
whatever object state still fits the new definitions (a property a
redeclared kind dropped is dropped; a new one starts at its default;
a row whose identifier nothing answers for is dropped and reported).
`reset` is a sweep's mechanism — the schedule is the host's. `inspect`
for the owner is the file list, the limits, what is absent, faults
without their chains, presence as a count and the donated misses; the
operator's report adds the chains and the actors by name.

Limits are the microworld's, with defaults (`Limits`): rooms, objects,
kinds, files, source bytes, live instances, and retention for actions
and misses. The language's own caps are lang's and not configurable.

## The store port

`SproutStore` is six methods (`transaction`, `read`, and the
housekeeping `trim`, `destroyMicroworld`, `forgetActor`, `exportActor`)
over seventeen on a transaction, across seven record types exported as
zod schemas: `MicroworldRecord`, `ObjectRecord`, `ActorRecord`,
`MemoryRecord`, `ActionRecord` (which carries **no actor**),
`MissRecord`, `ActorExport`. The contract every adapter must meet:

1. Write turns on one microworld are serialized; read turns are not.
2. `fn` may be invoked more than once — it must have no effect outside
   the transaction it is handed, and every id it mints must derive from
   state it read inside that same invocation.
3. A turn's writes land together or not at all; a fault writes nothing
   of the world — only its action record, and the actor's own row as a
   read turn would touch it (heartbeat, pending drained).
4. Locks have timeouts and are not tuples.
5. The host may supply the transaction.
6. Housekeeping is not a turn.

`memoryStore()` — a `Map` and a promise chain per microworld, writes
buffered until the transaction body returns — is what core's own specs
run on and what a host's unit tests use in place of a database.

## The conformance suite

`@overstory/sprout-core/conformance` exports `cases`, each `{ name,
proves, run(makeStore) }`, importing no test framework; a host runs them
under whatever runner it has:

```ts
import { cases } from '@overstory/sprout-core/conformance';
for (const c of cases) it(c.name, () => c.run(() => myStore()));
```

`reentrant(store)` wraps a store so every transaction body runs twice —
once rolled back, once for real — which is how the suite proves rule 2.
`cannotProve` names what a single-backend run cannot show (real
contention, lock timeouts firing); those are proved once against a real
Postgres.

## For a host's tests

`@overstory/sprout-core/testing` exports `testWorld(archive, { ext? })`:
a runtime over the memory store with the archive loaded, and
`play(line, as?)` that types a line as an actor and returns the lines
that came back.
