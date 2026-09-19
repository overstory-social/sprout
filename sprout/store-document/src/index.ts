// @overstory/sprout-store-document — the Sprout runtime's store on a
// document backend (MIT; stage 3 of the split,
// design/proposals/2026-09-17-sprout-split.md §5.2). Five methods over
// any key → document database, the layout split by write rate, a memory
// backend and an IndexedDB backend. It imports core and zod, nothing
// else; a host brings the backend.

export * from './backend.js';
export * from './indexeddb.js';
export * from './store.js';
