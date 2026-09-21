import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // CLAUDE.md, The legacy fence: suites for the previous language wait here
    // until the issue that replaces them deletes them.
    exclude: ['**/node_modules/**', '**/dist/**', '**/legacy/**'],
  },
});
