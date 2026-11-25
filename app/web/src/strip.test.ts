import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { drawStrip, STRIP_SIZE, type StripValues } from './strip';

// The tap's firmware draws these same strips in esp32/test/test_strip and checks
// them against the same CRC-32s, so the preview matches the screen pixel for pixel.
// After changing how the strip looks, update the numbers in both tests (pio test
// -v prints the firmware's).
const fullKeg: StripValues = {
  laserChosen: true,
  laserNumber: 2,
  mode: 'smart',
  percent: 62,
  litresTenths: 117,
  temperatureTenths: 183,
  batteryPercent: 100,
  modeWarning: false,
  noSignal: false,
  test: false,
};

const modeWarning: StripValues = { ...fullKeg, mode: 'eco', modeWarning: true };

const nothingYet: StripValues = {
  laserChosen: false,
  laserNumber: 0,
  mode: 'smart',
  percent: null,
  litresTenths: null,
  temperatureTenths: null,
  batteryPercent: null,
  modeWarning: false,
  noSignal: false,
  test: false,
};

const waiting: StripValues = { ...nothingYet, laserChosen: true, laserNumber: 1 };
const knownEmpty: StripValues = { ...fullKeg, knownEmpty: true, percent: 0, litresTenths: 0 };
const levelWarning: StripValues = { ...knownEmpty, levelWarning: true };

const cases: Array<[string, StripValues, number]> = [
  ['full keg', fullKeg, 0xa256b4e6],
  ['orange', { ...fullKeg, percent: 40, litresTenths: 76 }, 0xb36a43a7],
  ['red', { ...fullKeg, percent: 15, litresTenths: 28 }, 0x1ab38d76],
  ['low battery', { ...fullKeg, laserNumber: 3, batteryPercent: 7 }, 0x275e7510],
  ['mode warning', modeWarning, 0x0ac96a65],
  ['no signal', { ...modeWarning, noSignal: true }, 0x49224344],
  [
    'full and cold',
    {
      ...fullKeg,
      laserNumber: 1,
      percent: 100,
      litresTenths: 190,
      temperatureTenths: -15,
      batteryPercent: 55,
    },
    0xcf0fa36f,
  ],
  ['test values', { ...fullKeg, test: true }, 0xbb2fb6bb],
  ['no laser', nothingYet, 0x5c3e9a7c],
  ['waiting', waiting, 0x250b2f4f],
  ['waiting, eco', { ...waiting, mode: 'eco' }, 0x618f110f],
  ['waiting, no number', { ...waiting, laserNumber: 0 }, 0xf825c7ca],
  ['waiting, mode warning', { ...waiting, modeWarning: true }, 0x982153f0],
  ['never heard', { ...waiting, modeWarning: true, noSignal: true }, 0xa8e6a1a7],
  ['known empty', knownEmpty, 0xb8022b48],
  ['level warning', levelWarning, 0x873bdb5d],
  ['both warnings', { ...levelWarning, modeWarning: true }, 0x873bdb5d],
  ['empty no signal', { ...levelWarning, noSignal: true }, 0xf9622c09],
  ['empty warm', { ...levelWarning, temperatureTenths: 205 }, 0xb22a940d],
];

describe('drawStrip', () => {
  it('uses the same warning slot for the sensor disagreement, ahead of the mode warning', () => {
    const values: StripValues = {
      ...fullKeg,
      knownEmpty: true,
      percent: 0,
      litresTenths: 0,
      levelWarning: true,
    };
    expect(drawStrip({ ...values, modeWarning: true })).toEqual(drawStrip(values));
    expect(drawStrip(values)).not.toEqual(drawStrip({ ...values, levelWarning: false }));
  });

  it('keeps known-empty numbers visible with the no-signal icon taking priority', () => {
    const values: StripValues = {
      ...fullKeg,
      knownEmpty: true,
      percent: 0,
      litresTenths: 0,
      noSignal: true,
    };
    expect(drawStrip({ ...values, levelWarning: true })).toEqual(drawStrip(values));
    expect(drawStrip(values)).not.toEqual(drawStrip({ ...values, knownEmpty: false }));
  });

  it('fills the strip', () => {
    expect(drawStrip(fullKeg)).toHaveLength(STRIP_SIZE);
  });

  it.each([
    ['ordinary readings', 62, 40, false],
    ['no temperature', 62, null, false],
    ['single-digit negative temperature', 62, -15, false],
    ['full keg', 100, 40, true],
    ['double-digit temperature', 62, 205, true],
  ] as const)(
    'uses compact spacing only when needed: %s',
    (_name, percent, temperature, compact) => {
      const strip = drawStrip({
        ...modeWarning,
        laserNumber: 1,
        percent,
        temperatureTenths: temperature,
      });
      let ink = false;
      for (let row = 0; row < 79; row++) {
        for (let column = 127; column < 131; column++) {
          const byte = strip[row * 200 + (column >> 1)]!;
          const colour = column % 2 === 0 ? byte >> 4 : byte & 0x0f;
          ink ||= colour !== 1;
        }
      }
      expect(ink).toBe(!compact);
    }
  );

  it.each(['smart', 'eco'] as const)('keeps the %s icons clear of both values', (mode) => {
    for (const percent of [11, 100]) {
      for (const laserNumber of [1, 3]) {
        const strip = drawStrip({
          ...modeWarning,
          mode,
          laserNumber,
          percent,
          litresTenths: percent === 100 ? 190 : 22,
          temperatureTenths: 205,
        });

        for (let row = 0; row < 79; row++) {
          for (const [left, right] of [
            [127, 131],
            [268, 275],
          ] as const) {
            for (let column = left; column < right; column++) {
              const byte = strip[row * 200 + (column >> 1)]!;
              const colour = column % 2 === 0 ? byte >> 4 : byte & 0x0f;
              expect(colour).toBe(1);
            }
          }
        }
      }
    }
  });

  it.each(cases)('draws %s like the firmware', (_name, values, firmwareCrc) => {
    expect(crc32(drawStrip(values))).toBe(firmwareCrc);
  });
});
