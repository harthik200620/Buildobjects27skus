import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';

/** Next aliases `server-only` at build time; under vitest it must resolve to an empty module. */
const stubServerOnly = (): Plugin => ({
  name: 'stub-server-only',
  enforce: 'pre',
  resolveId: (id) => (id === 'server-only' ? '\0server-only' : null),
  load: (id) => (id === '\0server-only' ? 'export {}' : null),
});

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]+$/, '');

export default defineConfig({
  plugins: [stubServerOnly()],
  resolve: { alias: [{ find: /^@\//, replacement: `${root}/` }] },
  test: { environment: 'node', include: ['lib/**/*.test.ts', 'app/**/*.test.ts'], testTimeout: 15_000 },
});
