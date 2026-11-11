import { describe, expect, it } from 'vitest';

import { checkKegLines, MAX_LINE_LENGTH } from '../../scripts/keg-lines.ts';
import { dateLine, kegLines, pickLine } from './keg-states';

describe('the keg states', () => {
  it('never takes the line it took last time', () => {
    const lines = ['Gone too soon', 'Tapped out', 'Who drank it all?'];

    for (const random of [0, 0.3, 0.6, 0.99]) {
      expect(pickLine(lines, 'Tapped out', () => random)).not.toBe('Tapped out');
    }

    expect(pickLine(lines, 'Tapped out', () => 0)).toBe('Gone too soon');
    expect(pickLine(lines, 'Tapped out', () => 0.99)).toBe('Who drank it all?');
  });

  it('takes any line the first time, and the only line every time', () => {
    expect(pickLine(['Gone too soon', 'Tapped out'], null, () => 0.99)).toBe('Tapped out');
    expect(pickLine(['Tapped out'], 'Tapped out', () => 0.5)).toBe('Tapped out');
    // A line no longer in the list doesn't stop any being taken.
    expect(pickLine(['Coming soon'], 'Worth the wait', () => 0)).toBe('Coming soon');
  });

  it('says when the keg was kicked or cleaned', () => {
    const date = new Date('2026-11-09T12:00:00Z');

    expect(dateLine('empty', date)).toBe('Kicked 9 Nov');
    expect(dateLine('ready', date)).toBe('Cleaned 9 Nov');
  });

  it('reads the lines in config/keg-lines.json, with apostrophes made curly', () => {
    expect(kegLines.empty.length).toBeGreaterThan(0);
    expect(kegLines.ready).toContain('Something’s brewing');
  });
});

describe('checking config/keg-lines.json', () => {
  const lines = (empty: unknown, ready: unknown = ['Coming soon']) =>
    checkKegLines({ empty, ready });

  it('tidies each line', () => {
    expect(lines(['  Tapped out ', "Who's thirsty?"]).empty).toEqual([
      'Tapped out',
      'Who’s thirsty?',
    ]);
    // Only between letters: a quote around words stays as typed.
    expect(lines(["'Kicked'"]).empty).toEqual(["'Kicked'"]);
  });

  it('turns down a missing or empty list, or a blank line', () => {
    expect(() => checkKegLines({ empty: ['Tapped out'] })).toThrow(/"ready" should be a list/);
    expect(() => lines([])).toThrow(/"empty" should be a list of at least one line/);
    expect(() => lines(['Tapped out', '  '])).toThrow(/line 2 of "empty" should be some words/);
    expect(() => checkKegLines(['Tapped out'])).toThrow(/should have an "empty" list/);
  });

  it('turns down a line too long to read, or with a letter the font lacks', () => {
    expect(() => lines(['x'.repeat(MAX_LINE_LENGTH)])).not.toThrow();
    expect(() => lines(['The sequel is coming soon'])).toThrow(
      /"The sequel is coming soon" is 25 characters\. The most is 24/
    );
    expect(() => lines(['Ein Prosit, café'])).toThrow(/has "é", which the chalk font doesn't have/);
  });
});
