# @overstory/sprout/store-document

The Sprout runtime's store on a document backend: five methods over any
key → document database, the layout split by write rate, and two
backends — memory, and IndexedDB for a single-player microworld in a
browser tab, no server at all.

MIT. Imports `@overstory/sprout/core` and zod, and nothing else; a host
brings the backend.

## Use

A microworld in a tab — the smallest embedding there is:

```ts
import { createRuntime } from '@overstory/sprout/core';
import { documentStore, indexedDbBackend } from '@overstory/sprout/store-document';

const runtime = createRuntime({ store: documentStore(indexedDbBackend('my-microworld')) });
await runtime.load('shed', archive, new Date());
const turn = await runtime.turn({
  microworldId: 'shed',
  actor: { id: 'me', name: 'me' },
  input: { kind: 'enter' },
  now: new Date(),
});
```

Under test, or in a CLI's `--store memory`: `documentStore(memoryBackend())`.

## The backend

```ts
interface DocumentBackend {
  get(key: string): Promise<unknown | null>;
  put(key: string, doc: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>; // sorted
  transact<T>(keys: string[], fn: (tx: DocumentWriter) => Promise<T>): Promise<T>;
}
```

`transact` serializes on `keys` (taken in sorted order, so two
transactions never deadlock), lands the writes `fn` made through `tx`
together or not at all when `fn` returns, and MAY run `fn` more than
once — Firestore and Mongo do on contention — which is why core's port
says a transaction body must have no effect outside the tx it is handed
and derive every serial it issues from state it read inside. Outside a
transaction `put` and `delete` are single atomic writes. The tx handed
in is how a backend tells this transaction's writes from another's —
`runTransaction(fn(tx))` and an IndexedDB transaction have exactly this
shape.

Firestore, Mongo and a Durable Object's storage are each an
implementation of these five over their own transaction API, written
when a host wants them. `KeyLocks` and `Staging` are exported for that:
locks by key and a staged writer over a reader, which is most of a
backend.

## What it keeps

Every key starts with the microworld, URL-encoded (a microworld id may
carry a `/`, and `microworld/<zone>/` must not list the draft's):

| key                                 | document                                                          | written                          |
| ----------------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| `microworld/<id>/archive`           | `MicroworldRecord` — the archive as last loaded, the caps         | at publish                       |
| `microworld/<id>/state`             | `{ blob }` — every `StoredInstance` and tombstone, as ONE string  | when a turn changes something    |
| `microworld/<id>/counters`          | `{ serial, log, misses }` — the world's serial, and the sequences | when a turn changes or appends   |
| `microworld/<id>/visitors/<visit>`  | `StoredVisitor` — one small document per visitor                  | when a turn changes that visitor |
| `microworld/<id>/log/<sequence>`    | `LogEntry` — one document per entry, its number the sequence      | per write turn, publish, …       |
| `microworld/<id>/misses/<sequence>` | `MissRecord` — one document per donated miss                      | per miss                         |

The layout is split along the write-rate seam, not the read seam: the
instances are one document written only when a turn changes something,
and held as a string a document database will not index (a map of two
thousand small records would blow Firestore's index-entry ceiling); each
visitor is its own small document, found by its visit, so forgetting or
exporting one reads no other world's; the log and misses are
collections — one document per record, never a dated document appended
to, which reaches a document's size ceiling in an hour of play. What is
read back is validated by the record's zod schema (the language's, for
an instance or a visitor), dates travelling as ISO strings, and a
document that is not the record it should be is refused by key.

## The contract it meets

Core's store port asks six things of an adapter (the split proposal
§4.5); here they are met by:

1. `transact` on the state key for every write turn — reads never
   wait, and write nothing;
2. the serial and the counters read inside the transaction, so a re-run
   of `fn` issues the same serial and the same sequence;
3. the backend's single commit — every write staged until `fn` returns;
4. locks by key with no timeout of their own (a browser's Web Locks have
   `steal` and `ifAvailable`; a host that needs a timeout wraps the
   backend);
5. no — the store owns the transaction; a host that wants its own passes
   a backend whose `transact` joins it;
6. housekeeping as `list` + `delete` under the prefix, per microworld,
   under the state key; forgetting a visitor takes each world's state
   key in turn, so no write turn can write back what it took.

Core's conformance suite runs on BOTH backends in `conformance.spec.ts`,
every case — including the three a single Postgres connection cannot — and
under fake-indexeddb for the second. What no test here reaches is two
tabs on one origin, which is the Web Locks API's promise.

## IndexedDB

`indexedDbBackend(name, { factory?, locks? })`: one object store of
`{ key, doc }` rows in the database `name`, opened on first use;
`list` is a key range on the prefix. Transactions across the origin's
tabs are serialized by `navigator.locks` where the page has it and by an
in-process lock where it does not (Node, older WebViews); pass `locks:
null` to insist on the in-process one. Writes are staged while `fn` runs
and land in one readwrite transaction when it returns — an IndexedDB
transaction closes the moment the event loop turns with nothing pending
on it, and a turn's body awaits things that are not requests on it.
`close()` releases the connection.

A page of the log lists every entry's key under the microworld and reads
only the documents it hands back; the log is kept whole, so that listing
grows with the world's history, which is fine for one player; a host at
scale wants the SQL store.
