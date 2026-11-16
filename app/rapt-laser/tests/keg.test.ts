import { describe, expect, it } from 'vitest';
import { CORNY_KEG_19L, kegLevel } from '../src/index.js';

describe('kegLevel', () => {
  // What the tap shows at each reading from the jug calibration on 2026-11-16.
  it.each([
    [566, 0, 0, 0],
    [557, 0.5, 0.5, 2],
    [546, 1, 1, 5],
    [528, 1.5, 1.5, 7],
    [512, 2, 2, 10],
    [487, 2.5, 2.5, 13],
    [467, 3, 3, 15],
    [402, 5, 4.9, 25],
    [343, 7, 7, 37],
    [288, 9, 9, 47],
    [236, 11, 10.9, 57],
    [180, 13, 13, 68],
    [126, 15, 15, 79],
    [110, 15.5, 15.6, 82],
    [97, 16, 16, 84],
    [85, 16.5, 16.5, 87],
    [72, 17, 17, 89],
    [58, 17.5, 17.5, 92],
    [49, 18, 17.8, 93],
    [32, 18.5, 18.8, 99],
    [29, 19, 19, 100],
  ])(
    'at %i mm, with %f L in the keg, shows %f L and %i%%',
    (distanceMm, _inKeg, litres, percent) => {
      expect(kegLevel(distanceMm)).toEqual({ litres, percent });
    }
  );

  it('follows the domed bottom between its points', () => {
    // Halfway between 1 L and 1.5 L
    expect(kegLevel(537)).toEqual({ litres: 1.2, percent: 6 });
  });

  it('gives the percentage of a full keg', () => {
    // Half of 19 L, on the straight line
    expect(kegLevel(276)).toEqual({ litres: 9.5, percent: 50 });
  });

  it('is empty beyond the first point', () => {
    expect(kegLevel(567)).toEqual({ litres: 0, percent: 0 });
    expect(kegLevel(600)).toEqual({ litres: 0, percent: 0 });
  });

  it('is full nearer than the last point', () => {
    // What the laser read with the lid off
    expect(kegLevel(21)).toEqual({ litres: 19, percent: 100 });
    expect(kegLevel(0)).toEqual({ litres: 19, percent: 100 });
  });

  it('is full at 19 L', () => {
    expect(CORNY_KEG_19L.at(-1)?.litres).toBe(19);
  });

  it("uses another keg's calibration", () => {
    const keg = [
      { distanceMm: 300, litres: 0 },
      { distanceMm: 20, litres: 9.5 },
    ];

    // Half of 9.5 L is 4.75, shown as 4.7
    expect(kegLevel(160, keg)).toEqual({ litres: 4.7, percent: 50 });
  });

  it.each([
    [
      'distances going up',
      [
        { distanceMm: 22, litres: 0 },
        { distanceMm: 552, litres: 19 },
      ],
    ],
    [
      'litres going down',
      [
        { distanceMm: 552, litres: 19 },
        { distanceMm: 22, litres: 0 },
      ],
    ],
    ['one point', [{ distanceMm: 552, litres: 0 }]],
    ['no points', []],
  ])('rejects a calibration with %s', (_name, keg) => {
    expect(() => kegLevel(100, keg)).toThrow('from empty to full');
  });
});
