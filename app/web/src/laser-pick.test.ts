import { describe, expect, it } from 'vitest';

import {
  pickedStripValues,
  pickedTapLaser,
  pickQuery,
  sentLaserMessage,
  tapHasPick,
  type LaserPick,
} from './laser-pick';
import { NO_LASER, readTapLaser } from './lasers';

const laser2: LaserPick = {
  address: 'C4:A3:DF:A2:C5:1B',
  mode: 'smart',
  number: 2,
  reading: {
    mode: 'Smart',
    distanceMm: 91,
    litres: 16.5,
    percent: 86,
    batteryPercent: 85.6,
    temperatureC: 22.05,
  },
};

const noLaser: LaserPick = { address: NO_LASER, mode: 'smart', number: null, reading: null };

describe('a laser picked in the preview', () => {
  it('is what the tap will have once sent', () => {
    expect(pickedTapLaser(laser2)).toEqual({
      laser: { number: 2, address: 'C4:A3:DF:A2:C5:1B', mode: 'smart' },
      noLaser: false,
    });
    expect(pickedTapLaser(noLaser)).toEqual({ laser: null, noLaser: true });
  });

  it('is nothing to send when the tap has it, mode and all', () => {
    const tap = pickedTapLaser(laser2);

    expect(tapHasPick(laser2, tap)).toBe(true);
    expect(tapHasPick({ ...laser2, mode: 'eco' }, tap)).toBe(false);
    expect(tapHasPick(noLaser, tap)).toBe(false);
    expect(tapHasPick(noLaser, { laser: null, noLaser: true })).toBe(true);
    // None chosen yet isn't no laser on purpose.
    expect(tapHasPick(noLaser, { laser: null, noLaser: false })).toBe(false);
  });

  it('previews the strip from its latest reading, rounded as the tap rounds it', () => {
    expect(pickedStripValues(laser2)).toEqual({
      laserChosen: true,
      laserNumber: 2,
      mode: 'smart',
      percent: 86,
      litresTenths: 165,
      // 22.05° to the nearest tenth, half away from zero
      temperatureTenths: 221,
      batteryPercent: 85,
      modeWarning: false,
      noSignal: false,
      test: false,
    });

    const cold = { ...laser2.reading!, temperatureC: -1.25 };
    expect(pickedStripValues({ ...laser2, reading: cold })?.temperatureTenths).toBe(-13);
  });

  it('previews the strip waiting for a laser with no reading, or none for no laser', () => {
    expect(pickedStripValues({ ...laser2, number: null, reading: null })).toMatchObject({
      laserChosen: true,
      laserNumber: 0,
      percent: null,
      litresTenths: null,
      temperatureTenths: null,
      batteryPercent: null,
    });
    expect(pickedStripValues(noLaser)).toBeNull();
  });

  it('goes with the picture as POST /laser takes it', () => {
    expect(pickQuery(laser2).toString()).toBe('laser=C4%3AA3%3ADF%3AA2%3AC5%3A1B&mode=smart');
    expect(pickQuery(noLaser).toString()).toBe('laser=none&mode=smart');
  });

  it('says when the screen changes once sent', () => {
    expect(sentLaserMessage(pickedTapLaser(laser2))).toBe(
      "The screen updates once laser 2's first reading arrives, within a minute."
    );
    expect(sentLaserMessage(pickedTapLaser({ ...laser2, number: null }))).toMatch(
      /^The screen updates once the laser's/
    );
    expect(sentLaserMessage(pickedTapLaser(noLaser))).toBe(
      'With no laser, the picture fills the whole screen.'
    );
  });
});

describe("the tap's laser in its answers", () => {
  it('is read when the answer has it, and null from older firmware', () => {
    expect(
      readTapLaser({
        noLaser: false,
        laser: { number: 1, address: 'E5:4C:66:F9:E1:33', mode: 'eco' },
      })
    ).toEqual({ laser: { number: 1, address: 'E5:4C:66:F9:E1:33', mode: 'eco' }, noLaser: false });
    expect(readTapLaser({ noLaser: true, laser: null })).toEqual({ laser: null, noLaser: true });
    expect(readTapLaser({ success: true })).toBeNull();
  });
});
