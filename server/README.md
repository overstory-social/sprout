# @overstory/sprout-server

Sprout's reference host: a headless server that runs microworlds for
clients connected over a WebSocket. Its design is
[`docs/design/sprout-server.md`](../docs/design/sprout-server.md); the
spec's _The host contract_ still binds it.

- **Config:** TOML, checked by a zod schema whose defaults are the spec's
  Limits (`readConfig`).
- **Worlds:** each folder the config names is compiled strictly and
  published. A world that is refused is logged and not served.
- **Protocol:** `sprout.1` over a WebSocket, one connection per visitor,
  every message checked by core's `protocol.ts`.
- **Time:** the real clock ticks each occupied place every `tick_seconds`
  and runs the wakes that fall due. Each turn's seed is drawn at random
  and logged.
- **Identity:** a person's token is kept only as a hash, which is their
  visit.

In this build the store is kept in memory, and extensions are not loaded.

```ts
import { readConfig, serverLog, startServer } from '@overstory/sprout-server';
```
