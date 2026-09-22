// @overstory/sprout/store-sql — the Sprout runtime's store on Postgres
// (MIT). The `sprout` schema, its migrations exported as data with a
// runner, and an adapter for the store port that needs only
// `query(text, params)` — node-postgres and PGlite alike. It imports core
// and nothing else; a host brings the client.

export * from './migrations.js';
export * from './store.js';
