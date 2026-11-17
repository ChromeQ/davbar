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

const cases: Array<[string, StripValues, number]> = [
  ['full keg', fullKeg, 0xa256b4e6],
  ['orange', { ...fullKeg, percent: 40, litresTenths: 76 }, 0xb36a43a7],
  ['red', { ...fullKeg, percent: 15, litresTenths: 28 }, 0x1ab38d76],
  ['low battery', { ...fullKeg, laserNumber: 3, batteryPercent: 7 }, 0x275e7510],
  ['mode warning', modeWarning, 0x9bc375df],
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
];

describe('drawStrip', () => {
  it('fills the strip', () => {
    expect(drawStrip(fullKeg)).toHaveLength(STRIP_SIZE);
  });

  it.each(cases)('draws %s like the firmware', (_name, values, firmwareCrc) => {
    expect(crc32(drawStrip(values))).toBe(firmwareCrc);
  });
});
