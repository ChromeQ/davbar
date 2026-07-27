import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
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
