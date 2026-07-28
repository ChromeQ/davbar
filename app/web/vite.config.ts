import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { loadDeviceConfig, printDeviceConfig } from '../scripts/device-config.ts';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const { config: deviceConfig, configPath } = loadDeviceConfig();

printDeviceConfig(deviceConfig, configPath);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'device-config-html',
      transformIndexHtml: {
        order: 'pre',
        handler(html, context) {
          const title = context.filename.endsWith('connect.html')
            ? deviceConfig.connectTitle
            : deviceConfig.appTitle;

          return html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
        },
      },
    },
  ],
  define: {
    __DEVICE_CONFIG__: JSON.stringify(deviceConfig),
  },
  build: {
    rollupOptions: {
      input: {
        app: path.resolve(currentDirectory, 'index.html'),
        connect: path.resolve(currentDirectory, 'connect.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@chromeq/davbar-spectra6': path.resolve(currentDirectory, '../spectra6/src/index.ts'),
    },
  },
});
