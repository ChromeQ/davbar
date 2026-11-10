// Trims Roboto to what the web app's pages need, so both pages can carry it inside
// them instead of loading it from Google Fonts. The setup page is opened on a phone
// joined to the tap's own Wi-Fi, which has no internet, and text mode draws with it.
//
// Usage (from app/): pnpm roboto:subset
// Run it after changing the weights or characters below, and commit the generated
// file. Roboto is under the SIL Open Font License; the file keeps its copyright and
// license entries.
import fs from 'node:fs';
import path from 'node:path';

import subsetFont from 'subset-font';

import { repositoryDirectory } from './device-config.ts';

// The weights the pages use, as one variable font. Text mode draws at 400.
const weights = { min: 400, max: 700 };

const range = (first: number, last: number) =>
  String.fromCodePoint(...Array.from({ length: last - first + 1 }, (_, index) => first + index));

// ASCII; Latin-1, for accented letters and signs such as ° · ×; common
// punctuation, such as dashes, curly quotes, the bullet and …; and the euro, trade
// mark and minus signs. Anything else falls back to the browser's own font.
const characters = [
  range(0x20, 0x7e),
  range(0xa0, 0xff),
  range(0x2010, 0x2027),
  range(0x2030, 0x203a),
  '€™−',
].join('');

// Copyright, license and license URL
const licenseNameIds = [0, 13, 14];

const appDirectory = path.join(repositoryDirectory, 'app');
const sourcePath = path.join(
  appDirectory,
  'node_modules/@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2'
);
const outputPath = path.join(appDirectory, 'web/src/fonts/roboto.woff2');

const source = fs.readFileSync(sourcePath);
const subset = await subsetFont(source, characters, {
  targetFormat: 'woff2',
  variationAxes: { wght: weights },
  preserveNameIds: licenseNameIds,
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, subset);

console.log(
  `${path.relative(repositoryDirectory, outputPath)}: ${subset.length} bytes ` +
    `(from ${source.length}), weights ${weights.min}-${weights.max}`
);
