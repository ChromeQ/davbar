// What a keg state's line can be: the lines in config/keg-lines.json, checked
// when the web app is built (app/scripts/keg-lines.ts), and a line typed in
// Compose (PLAN.md, step 8h). It imports nothing, so the build's scripts can use
// it too.

const range = (first: number, last: number) =>
  String.fromCodePoint(...Array.from({ length: last - first + 1 }, (_, index) => first + index));

// The characters built into the chalk font, Permanent Marker (see
// app/scripts/fonts-subset.ts): letters, digits and ASCII punctuation, with
// curly quotes, dashes and the ellipsis. Accented letters would add a third to
// its size.
export const chalkCharacters = `${range(0x20, 0x7e)}‘’“”–—…`;

// Longer lines shrink too small to read on the screen.
export const MAX_LINE_LENGTH = 24;

// Trimmed, with an apostrophe between letters made curly, as it would be
// written by hand.
export const tidyLine = (line: string) => line.trim().replace(/(\p{L})'(\p{L})/gu, '$1’$2');

// In characters as they're seen, so "’" is one.
export const lineLength = (line: string) => [...line].length;

// The first character the chalk font doesn't have, or null.
export const missingCharacter = (line: string) =>
  [...line].find((character) => !chalkCharacters.includes(character)) ?? null;

// Why a line typed in Compose can't go on the board, or null.
export const typedLineProblem = (line: string) => {
  const missing = missingCharacter(tidyLine(line));

  if (missing) {
    return `The chalk font doesn't have “${missing}”. Use letters without accents, digits and ordinary punctuation.`;
  }

  if (lineLength(tidyLine(line)) > MAX_LINE_LENGTH) {
    return `A line can have at most ${MAX_LINE_LENGTH} characters, as longer ones are too small to read on the screen.`;
  }

  return null;
};
