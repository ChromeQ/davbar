import { describe, expect, it } from 'vitest';

import { lineLength, MAX_LINE_LENGTH, tidyLine, typedLineProblem } from './keg-line-rules';

describe('a line typed for a keg state', () => {
  it('is tidied as the list is: trimmed, with curly apostrophes', () => {
    expect(tidyLine("  Who's next? ")).toBe('Who’s next?');
    expect(lineLength('Who’s next?')).toBe(11);
  });

  it('can be anything the chalk font has, up to the most that reads', () => {
    expect(typedLineProblem("Back Friday – it's a big one…")).toMatch(/at most 24 characters/);
    expect(typedLineProblem('x'.repeat(MAX_LINE_LENGTH))).toBeNull();
    expect(typedLineProblem(`${'x'.repeat(MAX_LINE_LENGTH)}  `)).toBeNull();
    expect(typedLineProblem('Who’s next? “Soon”')).toBeNull();
    expect(typedLineProblem('')).toBeNull();
  });

  it('names a character the chalk font lacks', () => {
    expect(typedLineProblem('Café closed')).toBe(
      "The chalk font doesn't have “é”. Use letters without accents, digits and ordinary punctuation."
    );
    expect(typedLineProblem('Gone 🍺')).toMatch(/“🍺”/);
  });
});
