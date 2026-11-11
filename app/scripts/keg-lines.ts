// The keg states' top lines, from config/keg-lines.json, so puns can be added
// without changing code: "empty" for Keg empty and "ready" for Keg ready. Each
// time a state is picked, the web app takes one, never the one it took last time
// (see web/src/keg-states.ts). They're checked when the web app is built, so a
// line the screen can't show never reaches a tap; then upload the web app to
// each tap (pnpm device:upload:fs).
import fs from 'node:fs';
import path from 'node:path';

import { repositoryDirectory } from './device-config.ts';

export type KegLines = {
  empty: string[];
  ready: string[];
};

const range = (first: number, last: number) =>
  String.fromCodePoint(...Array.from({ length: last - first + 1 }, (_, index) => first + index));

// The characters built into the chalk font, Permanent Marker (see
// fonts-subset.ts): letters, digits and ASCII punctuation, with curly quotes,
// dashes and the ellipsis. Accented letters would add a third to its size.
export const chalkCharacters = `${range(0x20, 0x7e)}‘’“”–—…`;

// Longer lines shrink too small to read on the screen.
export const MAX_LINE_LENGTH = 24;

export const kegLinesPath = path.join(repositoryDirectory, 'config/keg-lines.json');

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The lines, checked and tidied: trimmed, and with an apostrophe between letters
// made curly, as it would be written by hand. file names the file in errors.
export const checkKegLines = (value: unknown, file = 'config/keg-lines.json'): KegLines => {
  if (!isObject(value)) {
    throw new Error(`${file} should have an "empty" list and a "ready" list of lines.`);
  }

  const list = (state: keyof KegLines) => {
    const lines = value[state];

    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error(`${file}: "${state}" should be a list of at least one line.`);
    }

    return lines.map((line: unknown, index) => {
      if (typeof line !== 'string' || line.trim() === '') {
        throw new Error(`${file}: line ${index + 1} of "${state}" should be some words.`);
      }

      const text = line.trim().replace(/(\p{L})'(\p{L})/gu, '$1’$2');
      const length = [...text].length;

      if (length > MAX_LINE_LENGTH) {
        throw new Error(
          `${file}: "${text}" is ${length} characters. The most is ${MAX_LINE_LENGTH}, ` +
            'as longer lines are too small to read on the screen.'
        );
      }

      const missing = [...text].find((character) => !chalkCharacters.includes(character));

      if (missing) {
        throw new Error(
          `${file}: "${text}" has "${missing}", which the chalk font doesn't have. ` +
            'Use letters without accents, digits and ordinary punctuation.'
        );
      }

      return text;
    });
  };

  return { empty: list('empty'), ready: list('ready') };
};

export const loadKegLines = (filePath = kegLinesPath): KegLines => {
  const file = path.relative(repositoryDirectory, filePath);
  let value: unknown;

  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Couldn't read ${file}: ${error instanceof Error ? error.message : error}`, {
      cause: error,
    });
  }

  return checkKegLines(value, file);
};
