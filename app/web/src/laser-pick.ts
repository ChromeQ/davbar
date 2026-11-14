// A laser picked in the page's preview: nothing reaches the tap until "Upload to
// display" sends it, with the picture if there's a new one, so the screen redraws
// once for both (PLAN.md, step 8d).
import { NO_LASER, type ChosenMode, type LaserReading, type TapLaser } from './lasers';
import type { StripValues } from './strip';

export type LaserPick = {
  // The laser's address, or NO_LASER for none on purpose
  address: string;
  mode: ChosenMode;
  // In config/lasers.json, or null
  number: number | null;
  // Its latest reading when it was picked, for the preview's strip, or null
  reading: LaserReading | null;
};

// The pick as the tap will have it.
export const pickedTapLaser = (pick: LaserPick): TapLaser =>
  pick.address === NO_LASER
    ? { laser: null, noLaser: true }
    : { laser: { number: pick.number, address: pick.address, mode: pick.mode }, noLaser: false };

// Whether the tap already has this choice, so there's nothing to send.
export const tapHasPick = (pick: LaserPick, tap: TapLaser) =>
  pick.address === NO_LASER
    ? tap.noLaser
    : tap.laser?.address === pick.address && tap.laser.mode === pick.mode;

// Half a tenth rounds away from zero, as the tap's does.
const hundredthsToTenths = (hundredths: number) =>
  Math.sign(hundredths) * Math.floor((Math.abs(hundredths) + 5) / 10);

// The strip the tap will draw for a picked laser, from its latest reading, as
// the tap reads it (esp32/lib/Strip/StripTracker), or waiting for one. null for
// no laser, which has no strip.
export const pickedStripValues = (pick: LaserPick): StripValues | null => {
  if (pick.address === NO_LASER) {
    return null;
  }

  const reading = pick.reading;

  return {
    laserChosen: true,
    laserNumber: pick.number ?? 0,
    mode: pick.mode,
    percent: reading ? reading.percent : null,
    litresTenths: reading ? Math.round(reading.litres * 10) : null,
    temperatureTenths:
      reading && reading.temperatureC !== null
        ? hundredthsToTenths(Math.round(reading.temperatureC * 100))
        : null,
    batteryPercent:
      reading && reading.batteryPercent !== null
        ? Math.min(100, Math.floor(reading.batteryPercent))
        : null,
    // Each takes the tap a while to decide, so a new choice starts without.
    modeWarning: false,
    noSignal: false,
    test: false,
  };
};

// What POST /image takes with the picture, as POST /laser takes it.
export const pickQuery = (pick: LaserPick) =>
  new URLSearchParams({ laser: pick.address, mode: pick.mode });

// What "Upload to display" says about the laser it sent. A new laser's redraw
// waits for its first reading, so the strip isn't drawn empty.
export const sentLaserMessage = (tap: TapLaser) => {
  if (tap.noLaser) {
    return 'With no laser, the picture fills the whole screen.';
  }

  if (!tap.laser) {
    return '';
  }

  const name = tap.laser.number === null ? 'the laser' : `laser ${tap.laser.number}`;

  return `The screen updates once ${name}'s first reading arrives, within a minute.`;
};
