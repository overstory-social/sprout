# @overstory/sprout/core

The runtime's store port and what it stores: the record types (zod
schemas, since an adapter validates what it reads back), the `SproutStore`
interface, the memory store every suite runs on, and the conformance
suite every adapter must pass.

A world's state is the language's stored form (the spec's _The runtime ›
State_): `state()` reads its serial, its `StoredInstance`s, its
`StoredVisitor`s and its tombstones, and `putState` writes the change set
a turn's draft made (`storedChanges`), serial included. An instance's
memory is keyed by the actor's instance id, so `forgetVisitor(visit)`
reads across every instance of each world holding the visit, taking the
visitor's record, their instance and what it held, and every memory of
them; `exportVisitor` hands back the same, but what their instance held.
Reads write nothing.

A world's turns run against a store through `runCommand`, `runTick`,
`runWake`, `runMaintenance`, `runArrival`, `runDeparture` and `runPoll`
(`turns.ts`): a write turn runs in the store's transaction, under the
world's lock, and writes its change set only where it committed, so a
fault writes nothing of the world; a poll reads a snapshot and takes no
lock. `runView` polls a visitor's view, and a `ViewCache` keeps each one
until a committed turn's `stale` names its visitor (`views.ts`).

Conversation between visitors is the host's, beside the world and never
in it (the spec's _The host contract › Conversation_): `runConversation`
checks a line against the host's `ConversationRules` (a length cap and a
pace, each unbounded where unset), a `ConversationPace` and the host's
`moderate`, and gives back who stands in the speaker's place to read it,
or a refusal with words the speaker is shown (`conversation.ts`). It
runs no turn, writes nothing of the world, appends nothing to the log
and stores nothing; delivering it, beside the world's words, is the
host's.

What each client is sent is negotiated with it (the spec's _Extensions ›
Effects are additive_): `negotiate` reads a client's `ClientDeclaration`,
the extension statements whose payloads it renders by extension and
major, against the world's pinned extensions, and grants those the host
supplies at that major, declining the rest with words
(`capabilities.ts`). `deliver` then sends each effect to a visit in order,
a prose effect as its words and an extension's as its payload where its
statement was granted, else as its transcript line; `sendView` does the
same for what a view's description recorded (`delivery.ts`). A client
that declares nothing is `TEXT_ONLY` and reads every effect as words.
A screen reader is one: `announce` speaks each effect it is sent, how
urgently decided by its kind alone (`screen-reader.ts`).

Every write turn appends its entry to the world's event log in the same
transaction (the spec's _The runtime › The log_): its inputs and seed,
its budgets, what it said and any fault; so does every publish
(`publishWorld`), withholding (`logWithholding`) and a poll's fault.
`readLog` and `wholeLog` read it back, oldest first and numbered from 1,
and `replayLog` runs every turn in it again, each against the bundle of
the publish before it, reporting any turn that does not reproduce
(`log/`). The log is kept whole: `trim` takes only misses. What the
conformance suite proves is the contract:

1. Write turns on one microworld are serialized; read turns are not.
2. A transaction's function may be invoked more than once and must have
   no effect outside the transaction it is handed.
3. A turn's writes land together or not at all.
4. Locks have timeouts.
5. The host may supply the transaction.
6. Housekeeping is not a turn; what of it writes a world's state waits
   on that world's lock.

MIT. Imports the language and zod, and nothing else; `conformance.ts`
imports no test framework, so a host runs it under whatever runner it has:

```ts
import { CONFORMANCE } from '@overstory/sprout/conformance';
for (const c of CONFORMANCE) it(c.name, () => c.run(() => myStore()));
```
