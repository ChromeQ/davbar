import { describe, expect, it } from 'vitest';

import {
  MAX_SOURCE_BYTES,
  readPictureSource,
  sourceText,
  type PictureSource,
} from './picture-source';

const keg: PictureSource = {
  kind: 'keg',
  state: 'empty',
  line: 'Gone too soon',
  date: '2026-11-13T09:00:00.000Z',
};

const text: PictureSource = {
  kind: 'text',
  text: 'Back soon',
  font: 'Georgia',
  size: 64,
  colour: '#000000',
  background: { style: 'linear', colour: '#ffffff', endColour: '#ffd400' },
};

describe('how the page drew a picture', () => {
  it('comes back from the tap as it was sent', () => {
    for (const source of [keg, text]) {
      expect(readPictureSource(sourceText(source))).toEqual(source);
    }
  });

  it("is left off when it's too long for the tap to keep", () => {
    const long = { ...text, text: 'é'.repeat(MAX_SOURCE_BYTES / 2) };

    expect(sourceText(long)).toBeNull();
  });

  it("is nothing when there's none, or it can't be read", () => {
    const changed = (changes: Record<string, unknown>) =>
      readPictureSource(JSON.stringify({ ...text, ...changes }));

    expect(readPictureSource(null)).toBeNull();
    expect(readPictureSource('not JSON')).toBeNull();
    expect(readPictureSource(JSON.stringify({ kind: 'beer' }))).toBeNull();
    expect(readPictureSource(JSON.stringify({ ...keg, state: 'kicked' }))).toBeNull();
    expect(readPictureSource(JSON.stringify({ ...keg, date: 'Thursday' }))).toBeNull();
    expect(changed({ font: 'Comic Sans MS' })).toBeNull();
    expect(changed({ size: '64' })).toBeNull();
    expect(changed({ colour: 'black' })).toBeNull();
    expect(
      changed({ background: { style: 'tartan', colour: '#ffffff', endColour: '#000000' } })
    ).toBeNull();
  });
});
