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

const cases: Array<[string, StripValues, number]> = [
  ['full keg', fullKeg, 0x8a974b40],
  ['orange', { ...fullKeg, percent: 40, litresTenths: 76 }, 0x5bbb82c2],
  ['red', { ...fullKeg, percent: 15, litresTenths: 28 }, 0x50aae884],
  ['low battery', { ...fullKeg, laserNumber: 3, batteryPercent: 7 }, 0x53e20d63],
  ['mode warning', modeWarning, 0x2889c7dd],
  ['no signal', { ...modeWarning, noSignal: true }, 0x9381743a],
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
    0xa4fd7742,
  ],
  ['test values', { ...fullKeg, test: true }, 0x227369f7],
  ['no laser', nothingYet, 0x15d02483],
  ['waiting', { ...nothingYet, laserChosen: true, laserNumber: 1 }, 0xb024e814],
];

describe('drawStrip', () => {
  it('fills the strip', () => {
    expect(drawStrip(fullKeg)).toHaveLength(STRIP_SIZE);
  });

  it.each(cases)('draws %s like the firmware', (_name, values, firmwareCrc) => {
    expect(crc32(drawStrip(values))).toBe(firmwareCrc);
  });
});
