# @overstory/sprout/store-sql

The Sprout runtime's store on Postgres: the `sprout` schema, its
migrations exported as data with a runner, and an adapter for
`@overstory/sprout/core`'s store port that needs only
`query(text, params)` — node-postgres and PGlite alike.

MIT. Imports core, and nothing else; a host brings the client.

## Use

```ts
import { createRuntime } from '@overstory/sprout/core';
import { runMigrations, sqlStore } from '@overstory/sprout/store-sql';

await runMigrations(client); // once — or apply `migrations` through your own ledger

const runtime = createRuntime({
  // a client already inside your transaction: the store only locks
  store: sqlStore({ client }),
  // …or open one per call on a pooled client
  // store: sqlStore({ transaction: (fn) => pool.transaction(fn) }),
});
```

## What it keeps

A table per part of what the store port keeps, in its own schema, with
no foreign key to any table of yours:

| table               | holds                                      | notes                                                    |
| ------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `sprout.microworld` | `MicroworldRecord`                         | the archive as last published, its stamp, its caps       |
| `sprout.serial`     | the world's serial                         | off the row a turn reads                                 |
| `sprout.instance`   | `StoredInstance`, but its memory           | by microworld and id; host seconds as `bigint`           |
| `sprout.memory`     | an instance's memory of one actor          | a row per actor, indexed by actor for `forgetVisitor`    |
| `sprout.visitor`    | `StoredVisitor`                            | indexed by visit for `forgetVisitor` and `exportVisitor` |
| `sprout.tombstone`  | a declared object destroyed, kept for good | by microworld and id                                     |
| `sprout.action`     | `ActionRecord`                             | per write turn; **no actor column**, by design           |
| `sprout.miss`       | `MissRecord`                               | donated misses, against the microworld                   |
| `sprout.meta`       | —                                          | the schema version, checked on first use                 |

Ids are `text` — declared paths and minted ids, and whatever your visit
keys are. Never join this schema to a table of your own in SQL: render
the id in code and bind it as a parameter. What is read back is checked
by the language's schema for its record and handed back in code-unit
order, since a collation's order is not the port's.

## The contract it meets

Core's store port asks six things of an adapter (the split proposal
§4.5); here they are met by:

1. a per-microworld `pg_advisory_xact_lock` on every write transaction —
   reads never wait;
2. `fn` run once (Postgres does not re-run a transaction);
3. writes landing together or not at all — the host's transaction, when
   the host supplied the client;
4. `SET LOCAL lock_timeout` (5 s by default) so a stuck turn fails fast;
5. the host may supply the transaction;
6. housekeeping as set-based statements; `forgetVisitor` takes the lock
   of every world holding the visit, in one order, as a write turn does.

Core's conformance suite runs against PGlite in `conformance.spec.ts`,
minus the three cases that need a second backend to wait on (real
contention; a read spanning a concurrent commit; a forget waiting on a
turn) — those are proved against a real Postgres by
`contention.db.spec.ts`, where `DATABASE_URL` is set.

## Migrations

`migrations` is an ordered `{ name, sql }[]`; `runMigrations(client)`
applies what `sprout.meta` does not yet record, each in its own
transaction. A migration once released is never edited; `002` replaces
the state model `001` made with the stored form, dropping what it held,
which this runtime does not read. A host with its own ledger copies the
SQL into it and pins the copy to this export with a test, so a version
bump that changes the schema fails its gate. `sqlStore({ …, schemaVersion })` checks
`sprout.meta` on first use and throws with expected and found.
