// Trims the web app's fonts to what its pages need, so they're carried inside the
// pages instead of loaded from Google Fonts:
// - Roboto, in both pages. The setup page is opened on a phone joined to the tap's
//   own Wi-Fi, which has no internet, and text mode draws with it.
// - Permanent Marker, in the app page only, for the keg states' chalk writing
//   (see web/src/keg-states.ts).
//
// Usage (from app/): pnpm fonts:subset
// Run it after changing the fonts or the characters below, and commit the
// generated files. Roboto is under the SIL Open Font License and Permanent Marker
// under the Apache License 2.0; each file keeps its copyright and license entries.
import fs from 'node:fs';
import path from 'node:path';

import subsetFont from 'subset-font';

import { repositoryDirectory } from './device-config.ts';
import { chalkCharacters } from './keg-lines.ts';

const range = (first: number, last: number) =>
  String.fromCodePoint(...Array.from({ length: last - first + 1 }, (_, index) => first + index));

// For Roboto: ASCII; Latin-1, for accented letters and signs such as ° · ×; common
// punctuation, such as dashes, curly quotes, the bullet and …; and the euro, trade
// mark and minus signs. Anything else falls back to the browser's own font.
const pageCharacters = [
  range(0x20, 0x7e),
  range(0xa0, 0xff),
  range(0x2010, 0x2027),
  range(0x2030, 0x203a),
  '€™−',
].join('');

// Copyright, license and license URL
const licenseNameIds = [0, 13, 14];

const appDirectory = path.join(repositoryDirectory, 'app');

const fonts = [
  {
    // One variable font with the weights the pages use. Text mode draws at 400.
    source: '@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2',
    output: 'web/src/fonts/roboto.woff2',
    characters: pageCharacters,
    variationAxes: { wght: { min: 400, max: 700 } },
  },
  {
    // Only what the keg lines may use (see keg-lines.ts), as its hand-drawn
    // letters are big: with Latin-1 it would be 26 KB rather than 18 KB.
    source: '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2',
    output: 'web/src/fonts/permanent-marker.woff2',
    characters: chalkCharacters,
  },
];

for (const font of fonts) {
  const sourcePath = path.join(appDirectory, 'node_modules', font.source);
  const outputPath = path.join(appDirectory, font.output);
  const source = fs.readFileSync(sourcePath);
  const subset = await subsetFont(source, font.characters, {
    targetFormat: 'woff2',
    ...(font.variationAxes ? { variationAxes: font.variationAxes } : {}),
    preserveNameIds: licenseNameIds,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, subset);

  console.log(
    `${path.relative(repositoryDirectory, outputPath)}: ${subset.length} bytes ` +
      `(from ${source.length})`
  );
}
