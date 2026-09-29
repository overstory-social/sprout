import { compileWorld, publish } from './worlds.js';
import { worldRun, type ServerContext } from './context.js';
import { admit, negotiateIn } from './session.js';

// A world redeployed while the server runs (docs/design/sprout-server.md,
// Reloading; the spec's State › Redeploying): its folder compiled again,
// strictly, and where it compiles, published, so it starts again from its
// initial state on the new bundle, and everyone connected to it admitted
// again where visitors arrive, carrying nothing, under the nickname the
// host kept for them. One whose nickname the new world's words now claim
// is refused it and asked for another. Where it is refused, the refusal is
// logged and the running world is left as it was.

/** Redeploy the world in `dir`; whether it was, or was refused and left running as it was. */
export async function redeploy(
  context: ServerContext,
  dir: string,
): Promise<'redeployed' | 'refused'> {
  const compiled = compileWorld(dir, context.config);
  if ('refused' in compiled) {
    context.log.write(
      'error',
      `the world in ${dir} was changed and is refused; it runs as it was:\n${compiled.refused}`,
    );
    return 'refused';
  }
  const { world } = compiled;
  const now = context.clock.now();
  await publish(context.store, world, context.config, now, new Date(now * 1000));
  const old = context.worlds.get(world.id);
  const run = worldRun(world);
  context.worlds.set(world.id, run);
  context.log.write('info', `redeployed from ${dir}, bundle ${world.bundle.hash}`, world.id);
  for (const connection of old?.connections ?? []) {
    const nickname = connection.nickname!;
    connection.world = null;
    connection.lastStatus = null;
    connection.lastOffered = null;
    negotiateIn(connection, run);
    await admit(context, connection, { t: 'admit', world: world.id, nickname });
  }
  return 'redeployed';
}
