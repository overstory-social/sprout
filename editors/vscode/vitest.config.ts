import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // `vscode` exists only inside VS Code; a spec reaches the stand-in.
    alias: { vscode: fileURLToPath(new URL('./src/fixtures/vscode.ts', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
