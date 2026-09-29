import { watch as fsWatch } from 'node:fs';

import type { ServerContext } from './context.js';
import { redeploy } from './redeploy.js';

// `--watch` (docs/design/sprout-server.md, Reloading): each world's folder
// watched, and a change to it redeploys the world once the changes stop
// for a moment, so saving several files is one redeploy. A redeploy never
// runs over another; one asked for while one runs follows it.

/** How a folder is watched: `changed` called on any change inside it, until the returned stop. */
export type Watcher = (dir: string, changed: () => void) => () => void;

/** The file system's own watcher, over the folder and everything in it. */
export const FOLDER_WATCHER: Watcher = (dir, changed) => {
  const watcher = fsWatch(dir, { recursive: true }, changed);
  return () => watcher.close();
};

/** Watch every world `context` serves, from `dirs`, redeploying one whose folder changes; the returned call stops. */
export function watchWorlds(
  context: ServerContext,
  dirs: readonly string[],
  settleMs = 200,
  watcher: Watcher = FOLDER_WATCHER,
): () => void {
  let redeploying: Promise<unknown> = Promise.resolve();
  const stops = dirs.map((dir) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = watcher(dir, () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        redeploying = redeploying
          .then(() => redeploy(context, dir))
          .catch((error: unknown) => {
            context.log.write(
              'error',
              `the world in ${dir} could not be redeployed: ${String(error)}`,
            );
          });
      }, settleMs);
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      stop();
    };
  });
  return () => {
    for (const stop of stops) stop();
  };
}
