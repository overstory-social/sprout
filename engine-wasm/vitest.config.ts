import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'build-wasm.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
