import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import type { Plugin, Rolldown } from 'vite';

type OutputAsset = Rolldown.OutputAsset;
type OutputChunk = Rolldown.OutputChunk;

// Builds each page into one gzipped HTML file with its script and styles inside,
// such as dist/index.html.gz. Every file a browser downloads at the same time
// costs the ESP32 12-20 KB of memory, which it can't spare while it also
// listens for the lasers, so a page load must be a single download.
//
// Each page needs its own build with one entry (see vite.config.ts): shared
// chunks can't be inlined, so anything left over fails the build rather than
// shipping a page that quietly needs another file.

const pagePaths: Record<string, string> = {
  '/': 'index.html.gz',
  '/index.html': 'index.html.gz',
  '/connect.html': 'connect.html.gz',
};

const textOf = (file: OutputAsset | OutputChunk) => {
  if (file.type === 'chunk') {
    return file.code;
  }

  return typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
};

export const singleFilePage = (): Plugin => {
  let outDir = 'dist';

  return {
    name: 'single-file-page',
    enforce: 'post',

    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },

    generateBundle(_options, bundle) {
      const inlined = new Set<string>();

      const take = (reference: string) => {
        const fileName = reference.replace(/^\//, '');
        const file = bundle[fileName];

        if (!file) {
          this.error(`${reference} is referenced by a page but not in the bundle`);
        }

        inlined.add(fileName);

        return textOf(file);
      };

      const pages = Object.values(bundle).filter(
        (file): file is OutputAsset => file.type === 'asset' && file.fileName.endsWith('.html')
      );

      for (const page of pages) {
        const html = textOf(page)
          .replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_tag, src: string) => {
            // A script ends at the first "</script", even inside a string.
            const code = take(src).replaceAll('</script', '<\\/script');

            return `<script type="module">${code}</script>`;
          })
          .replace(/<link\b[^>]*>/g, (tag) => {
            const href = /\bhref="([^"]+)"/.exec(tag)?.[1];

            if (/\brel="modulepreload"/.test(tag)) {
              this.error(`${page.fileName} preloads ${href}, a shared chunk that can't be inlined`);
            }

            if (!href || !/\brel="stylesheet"/.test(tag) || /^https?:/.test(href)) {
              return tag;
            }

            return `<style>${take(href)}</style>`;
          });

        this.emitFile({
          type: 'asset',
          fileName: `${page.fileName}.gz`,
          source: gzipSync(html, { level: 9 }),
        });

        delete bundle[page.fileName];
      }

      // Anything else, such as a font or image too big to inline, would be a file
      // the tap never serves.
      const leftOver = Object.keys(bundle).filter(
        (fileName) => !fileName.endsWith('.gz') && !inlined.has(fileName)
      );

      if (leftOver.length > 0) {
        this.error(`Not inlined into any page: ${leftOver.join(', ')}`);
      }

      for (const fileName of inlined) {
        delete bundle[fileName];
      }
    },

    // `vite preview` serves the gzipped pages the way the ESP32 does.
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const pagePath = pagePaths[request.url?.split('?')[0] ?? ''];
        const file = pagePath && path.join(outDir, pagePath);

        if (!file || !existsSync(file)) {
          next();

          return;
        }

        response.setHeader('Content-Type', 'text/html');
        response.setHeader('Content-Encoding', 'gzip');
        createReadStream(file).pipe(response);
      });
    },
  };
};
