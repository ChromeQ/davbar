// A laser picked in the page's preview: nothing reaches the tap until "Upload to
// display" sends it, with the picture if there's a new one, so the screen redraws
// once for both (docs/display.md, A picture and its laser together).
import { modeLabel, NO_LASER, type ChosenMode, type LaserReading, type TapLaser } from './lasers';
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

// Whether the tap's strip values are for this pick: the same laser number and
// mode, or no laser.
const stripHasPick = (pick: LaserPick, values: StripValues) =>
  pick.address === NO_LASER
    ? !values.laserChosen
    : values.laserChosen && values.laserNumber === (pick.number ?? 0) && values.mode === pick.mode;

// A laser just sent shows in the preview for at most this long, if the tap's
// answers never have it, such as when another page chose another meanwhile.
export const SENT_PICK_MS = 30 * 1000;

// The laser just sent, while the tap's strip answers don't have it yet, or null.
// The tap works its strip out every 500ms (esp32/src/StripManager), so an answer
// straight after sending can have the new laser with the old values.
export const pendingSentPick = (
  sent: { pick: LaserPick; at: number } | null,
  strip: { receivedAt: number; values: StripValues } | null
): LaserPick | null => {
  if (!sent) {
    return null;
  }

  // Not answered since sending
  if (!strip || strip.receivedAt < sent.at) {
    return sent.pick;
  }

  return stripHasPick(sent.pick, strip.values) || strip.receivedAt >= sent.at + SENT_PICK_MS
    ? null
    : sent.pick;
};

// What POST /image takes with the picture, as POST /laser takes it.
export const pickQuery = (pick: LaserPick) =>
  new URLSearchParams({ laser: pick.address, mode: pick.mode });

// What "Upload to display" says about the laser it sent, given the tap's laser
// before. As the tap redraws (esp32/lib/Strip/StripTracker): a new laser's redraw
// waits up to a minute for its first reading, so the strip isn't drawn empty, and
// a new mode for the same laser redraws straight away.
export const sentLaserMessage = (tap: TapLaser, before: TapLaser | null = null) => {
  if (tap.noLaser) {
    return 'With no laser, the picture fills the whole screen.';
  }

  if (!tap.laser) {
    return '';
  }

  if (before?.laser?.address === tap.laser.address) {
    return `The screen redraws now to show ${modeLabel(tap.laser.mode)}.`;
  }

  const name = tap.laser.number === null ? 'the laser' : `laser ${tap.laser.number}`;

  return tap.laser.mode === 'eco'
    ? `In Eco, ${name}'s first reading can take up to an hour, so after a minute the screen says it's waiting for it.`
    : `The screen updates once ${name}'s first reading arrives, within a minute.`;
};
