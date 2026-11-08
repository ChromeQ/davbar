import { describe, expect, it } from 'vitest';
import { kegLevel } from '../src/index.js';

describe('kegLevel', () => {
  // Distances and volumes read from the RAPT app.
  it.each([
    [17, 19, 100],
    [133, 15, 79],
    [134, 14.9, 78],
    [135, 14.9, 78],
    [136, 14.9, 78],
    [250, 10.8, 56],
    [359, 6.9, 36],
  ])('matches the RAPT app at %i mm', (distanceMm, litres, percent) => {
    expect(kegLevel(distanceMm)).toEqual({ litres, percent });
  });

  it('is full at the full distance', () => {
    expect(kegLevel(22)).toEqual({ litres: 19, percent: 100 });
  });

  it('is empty at the empty distance and beyond', () => {
    expect(kegLevel(552)).toEqual({ litres: 0, percent: 0 });
    expect(kegLevel(600)).toEqual({ litres: 0, percent: 0 });
  });

  it('keeps exact tenths of a litre', () => {
    // 106 mm of beer is exactly 3.8 L and 20%
    expect(kegLevel(446)).toEqual({ litres: 3.8, percent: 20 });
  });

  it("uses another keg's calibration", () => {
    const keg = { capacityLitres: 9.5, emptyDistanceMm: 300, fullDistanceMm: 20 };

    // Half of 9.5 L is 4.75, shown as 4.7
    expect(kegLevel(160, keg)).toEqual({ litres: 4.7, percent: 50 });
  });

  it('rejects a calibration with empty above full', () => {
    const keg = { capacityLitres: 19, emptyDistanceMm: 22, fullDistanceMm: 552 };

    expect(() => kegLevel(100, keg)).toThrow('empty distance');
  });
});
