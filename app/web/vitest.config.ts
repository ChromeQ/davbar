import { defineConfig } from 'vitest/config';

// Its own config, so tests don't load a tap's profile like vite.config.ts does.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
