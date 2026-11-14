// The tap's lasers: GET /lasers lists them (and makes the tap ask every laser
// for the next minute), POST /laser chooses this tap's laser, and GET /status
// includes the chosen one without searching.
import { developmentDelay, isNumberOrNull, isObject, readDeviceJson } from './device-json';

export type ChosenMode = 'smart' | 'eco';

export type LaserReading = {
  mode: string;
  distanceMm: number;
  litres: number;
  percent: number;
  batteryPercent: number | null;
  temperatureC: number | null;
};

// rssi, lastHeardSeconds and reading are null for a laser not heard yet.
export type LaserItem = {
  number: number | null;
  address: string;
  rssi: number | null;
  lastHeardSeconds: number | null;
  reading: LaserReading | null;
};

export type ChosenLaser = {
  number: number | null;
  address: string;
  mode: ChosenMode;
};

// The address that chooses no laser on purpose, for a tap without one: its
// picture is then the whole screen (PLAN.md, step 8).
export const NO_LASER = 'none';

// This tap's laser: the chosen one, or null, and whether null is on purpose
// rather than none chosen yet.
export type TapLaser = {
  laser: ChosenLaser | null;
  noLaser: boolean;
};

export type LaserList = TapLaser & {
  lasers: LaserItem[];
};

// How often the picker asks for the list. Each request keeps the tap asking
// every laser for another minute.
export const LASER_POLL_MS = 3000;

const isLaserReading = (value: unknown): value is LaserReading =>
  isObject(value) &&
  typeof value.mode === 'string' &&
  typeof value.distanceMm === 'number' &&
  typeof value.litres === 'number' &&
  typeof value.percent === 'number' &&
  isNumberOrNull(value.batteryPercent) &&
  isNumberOrNull(value.temperatureC);

export const isLaserItem = (value: unknown): value is LaserItem =>
  isObject(value) &&
  isNumberOrNull(value.number) &&
  typeof value.address === 'string' &&
  isNumberOrNull(value.rssi) &&
  isNumberOrNull(value.lastHeardSeconds) &&
  (value.reading === null || isLaserReading(value.reading));

export const isChosenLaser = (value: unknown): value is ChosenLaser =>
  isObject(value) &&
  isNumberOrNull(value.number) &&
  typeof value.address === 'string' &&
  (value.mode === 'smart' || value.mode === 'eco');

const readChosenLaser = (value: unknown): ChosenLaser | null => {
  if (value === null) {
    return null;
  }

  if (!isChosenLaser(value)) {
    throw new Error('The device returned an invalid response.');
  }

  return value;
};

// Older firmware leaves it out.
const readNoLaser = (value: unknown) => value === true;

// The tap's laser from an answer that may carry it, such as GET /strip, or null
// if it doesn't (older firmware).
export const readTapLaser = (result: Record<string, unknown>): TapLaser | null =>
  typeof result.noLaser === 'boolean'
    ? { laser: readChosenLaser(result.laser ?? null), noLaser: result.noLaser }
    : null;

// Made-up lasers for `pnpm dev`, where there is no device: one heard in each
// mode, one not heard yet and one not in config/lasers.json.
const developmentLasers: LaserItem[] = [
  {
    number: 1,
    address: 'AA:00:00:00:00:01',
    rssi: -68,
    lastHeardSeconds: 2,
    reading: {
      mode: 'Smart',
      distanceMm: 86,
      litres: 16.8,
      percent: 88,
      batteryPercent: 100,
      temperatureC: 18.25,
    },
  },
  {
    number: 2,
    address: 'AA:00:00:00:00:02',
    rssi: -61,
    lastHeardSeconds: 14,
    reading: {
      mode: 'Ultra Low Power',
      distanceMm: 233,
      litres: 13.3,
      percent: 70,
      batteryPercent: 85.6,
      temperatureC: 4.5,
    },
  },
  { number: 3, address: 'AA:00:00:00:00:03', rssi: null, lastHeardSeconds: null, reading: null },
  { number: null, address: 'BB:00:00:00:00:09', rssi: -84, lastHeardSeconds: 40, reading: null },
];

let developmentChoice: TapLaser = {
  laser: { number: 2, address: 'AA:00:00:00:00:02', mode: 'smart' },
  noLaser: false,
};

// The made-up tap's laser, for its made-up strip.
export const developmentTapLaser = () => developmentChoice;

export const fetchLasers = async (): Promise<LaserList> => {
  if (import.meta.env.DEV) {
    await developmentDelay();
    return { ...developmentChoice, lasers: developmentLasers };
  }

  const response = await fetch('/lasers', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`The device answered with status ${response.status}.`);
  }

  const result = await readDeviceJson(response);

  if (!Array.isArray(result.lasers) || !result.lasers.every(isLaserItem)) {
    throw new Error('The device returned an invalid response.');
  }

  return {
    laser: readChosenLaser(result.laser),
    noLaser: readNoLaser(result.noLaser),
    lasers: result.lasers,
  };
};

// The chosen laser from GET /status, which (unlike GET /lasers) doesn't start
// a search.
export const fetchChosenLaser = async (): Promise<TapLaser> => {
  if (import.meta.env.DEV) {
    await developmentDelay();
    return developmentChoice;
  }

  const response = await fetch('/status', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`The device answered with status ${response.status}.`);
  }

  const result = await readDeviceJson(response);

  return { laser: readChosenLaser(result.laser), noLaser: readNoLaser(result.noLaser) };
};

// Chooses a laser by its address, or NO_LASER for none on purpose.
export const chooseLaser = async (address: string, mode: ChosenMode): Promise<TapLaser> => {
  if (import.meta.env.DEV) {
    await developmentDelay();
    const laser = developmentLasers.find((item) => item.address === address);
    developmentChoice =
      address === NO_LASER
        ? { laser: null, noLaser: true }
        : { laser: { number: laser?.number ?? null, address, mode }, noLaser: false };
    return developmentChoice;
  }

  const response = await fetch('/laser', {
    method: 'POST',
    body: new URLSearchParams({ address, mode }),
  });
  const result = await readDeviceJson(response);

  if (!response.ok || result.success !== true) {
    throw new Error(
      typeof result.message === 'string' && result.message
        ? result.message
        : `Saving the laser failed with status ${response.status}.`
    );
  }

  const chosen = { laser: readChosenLaser(result.laser), noLaser: readNoLaser(result.noLaser) };

  // What was asked for, or older firmware that doesn't know NO_LASER
  if (address === NO_LASER ? !chosen.noLaser : !chosen.laser) {
    throw new Error(
      address === NO_LASER
        ? "This tap's firmware is too old for no laser. Upload the firmware."
        : 'The device returned an invalid response.'
    );
  }

  return chosen;
};

// Sorts lasers in config/lasers.json order, then any others by address.
export const byLaserNumber = (a: LaserItem, b: LaserItem) =>
  (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) ||
  a.address.localeCompare(b.address);

export const laserName = (laser: { number: number | null }) =>
  laser.number === null ? 'Unknown laser' : `Laser ${laser.number}`;

export const modeLabel = (mode: ChosenMode) => (mode === 'eco' ? 'Eco' : 'Smart');

// The laser's own mode name, using this app's name for Ultra Low Power.
export const readingModeLabel = (mode: string) => (mode === 'Ultra Low Power' ? 'Eco' : mode);

// When the laser broadcasts the other mode from the one this tap expects, how
// to switch it. Session and Live Stream don't count: a laser drops back to its
// own mode after them.
export const modeMismatch = (reading: LaserReading | null, expected: ChosenMode) => {
  if (!reading) {
    return null;
  }

  const actual =
    reading.mode === 'Smart' ? 'smart' : reading.mode === 'Ultra Low Power' ? 'eco' : null;

  if (actual === null || actual === expected) {
    return null;
  }

  return `It's in ${modeLabel(actual)} Mode. Double-tap its Bluetooth button to switch it to ${modeLabel(expected)}.`;
};

export const formatAgo = (seconds: number) => {
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
};

export const formatReading = (reading: LaserReading) =>
  [
    `${reading.litres.toFixed(1)} L (${reading.percent}%)`,
    `${reading.distanceMm} mm`,
    readingModeLabel(reading.mode),
    reading.batteryPercent === null ? null : `battery ${Math.floor(reading.batteryPercent)}%`,
  ]
    .filter(Boolean)
    .join(' · ');
