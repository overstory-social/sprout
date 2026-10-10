import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { sha256, type Bundle } from '@overstory/sprout/lang';

// `sprout pack`'s assets: the files the world's extensions name, copied
// beside the cartridge into `<cartridge>.assets/` under the paths the world
// names them by, which is where a host that draws them looks (the spec's
// Extensions › What an extension may add). A file that changed since the
// compile read it is not copied: the cartridge records its hash.

/** The folder `cartridge`'s assets go in. */
export function assetsFolder(cartridge: string): string {
  return `${cartridge}.assets`;
}

/** Copy each file `bundle` names from the world folder `dir` into the cartridge's assets folder; how many. */
export function packAssets(dir: string, bundle: Bundle, cartridge: string): number {
  const into = resolve(assetsFolder(cartridge));
  for (const asset of bundle.assets) {
    const from = resolve(dir, asset.path);
    if (sha256(readFileSync(from)) !== asset.sha) {
      throw new Error(`${asset.path} changed while the world was being packed; pack again.`);
    }
    const to = join(into, asset.path);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  return bundle.assets.length;
}
