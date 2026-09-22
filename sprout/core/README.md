# @overstory/sprout/core

The runtime's store port and what it stores: the record types (zod
schemas, since an adapter validates what it reads back), the `SproutStore`
interface, the memory store every suite runs on, and the conformance
suite every adapter must pass.

The runtime itself — turns, the log, the view — is built by B34 onward
against the spec's *The runtime*; the records here still describe the
previous state model and are reshaped by B16 (instance ids and persisted
state) and B40 (the event log). What holds already, and what the
conformance suite proves, is the contract:

1. Write turns on one microworld are serialized; read turns are not.
2. A transaction's function may be invoked more than once and must have
   no effect outside the transaction it is handed.
3. A turn's writes land together or not at all.
4. Locks have timeouts.
5. The host may supply the transaction.
6. Housekeeping is not a turn.

MIT. Imports the language and zod, and nothing else; `conformance.ts`
imports no test framework, so a host runs it under whatever runner it has:

```ts
import { CONFORMANCE } from '@overstory/sprout/conformance';
for (const c of CONFORMANCE) it(c.name, () => c.run(() => myStore()));
```
