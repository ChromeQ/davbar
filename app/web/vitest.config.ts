import { defineConfig } from 'vitest/config';

import { loadKegLines } from '../scripts/keg-lines.ts';

// Its own config, so tests don't load a tap's profile like vite.config.ts does.
// The keg lines are the real ones from config/, so the tests check them too.
export default defineConfig({
  define: {
    __KEG_LINES__: JSON.stringify(loadKegLines()),
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
