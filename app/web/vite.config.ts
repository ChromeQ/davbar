import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { loadDeviceConfig, printDeviceConfig } from '../scripts/device-config.ts';
import { loadKegLines } from '../scripts/keg-lines.ts';
import { singleFilePage } from './single-file-page.ts';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const { config: deviceConfig, configPath } = loadDeviceConfig();
// Checked here, so a line the screen can't show stops the build.
const kegLines = loadKegLines();

// Each page is built on its own into a single file (see single-file-page.ts):
// `vite build --mode app`, then `vite build --mode connect`.
const pages = {
  app: 'index.html',
  connect: 'connect.html',
};

export default defineConfig(({ mode }) => {
  const page = mode === 'connect' ? 'connect' : 'app';

  // Once per build, not once per page
  if (page === 'app') {
    printDeviceConfig(deviceConfig, configPath);
  }

  return {
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
      singleFilePage(),
    ],
    define: {
      __DEVICE_CONFIG__: JSON.stringify(deviceConfig),
      __KEG_LINES__: JSON.stringify(kegLines),
    },
    build: {
      // The connect build adds its page next to the app's.
      emptyOutDir: page === 'app',
      // Every file goes inside its page, such as the Roboto font.
      assetsInlineLimit: () => true,
      rollupOptions: {
        input: path.resolve(currentDirectory, pages[page]),
      },
    },
    resolve: {
      alias: {
        '@chromeq/davbar-spectra6': path.resolve(currentDirectory, '../spectra6/src/index.ts'),
      },
    },
  };
});
