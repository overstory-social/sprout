// `npm run build -w editors/vscode`: bundles the extension's client into
// dist/extension.cjs and the language server into dist/server.cjs, so the
// packaged extension carries everything it runs and VS Code loads both as
// CommonJS. The language server's own build comes first.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = createRequire(import.meta.url).resolve(
  '@overstory/sprout-language-server/package.json',
);
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning' };

await build({
  ...common,
  entryPoints: [join(root, 'src', 'extension.ts')],
  outfile: join(root, 'dist', 'extension.cjs'),
  external: ['vscode'],
});
await build({
  ...common,
  entryPoints: [join(dirname(server), 'bin', 'sprout-language-server.js')],
  outfile: join(root, 'dist', 'server.cjs'),
});
