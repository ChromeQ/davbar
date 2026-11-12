import { defineConfig } from 'vitest/config';

import { defaultConfigPath, loadDeviceConfig } from '../scripts/device-config.ts';
import { loadKegLines } from '../scripts/keg-lines.ts';

// Its own config, so tests use the example profile (config/example.json) rather
// than a tap's, as vite.config.ts does. The keg lines are the real ones from
// config/, so the tests check them too.
export default defineConfig({
  define: {
    __DEVICE_CONFIG__: JSON.stringify(loadDeviceConfig(defaultConfigPath).config),
    __KEG_LINES__: JSON.stringify(loadKegLines()),
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
