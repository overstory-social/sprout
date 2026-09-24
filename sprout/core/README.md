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

A world's turns run against a store through `runWriteTurn`,
`runCommand` and `runPoll` (`turns.ts`): a write turn runs in the store's
transaction, under the world's lock, and writes its change set only where
it committed, so a fault writes nothing of the world; a poll reads a
snapshot and takes no lock. `runView` polls a visitor's view, and a
`ViewCache` keeps each one until a committed turn's `stale` names its
visitor (`views.ts`). The log is B40's, and B40 reshapes the action and miss records for the event log. What the
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
