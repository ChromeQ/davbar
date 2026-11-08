// The tap's lasers: GET /lasers lists them (and makes the tap ask every laser
// for the next minute), POST /laser chooses this tap's laser, and GET /status
// includes the chosen one without searching.

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

export type LaserList = {
  laser: ChosenLaser | null;
  lasers: LaserItem[];
};

// How often the picker asks for the list. Each request keeps the tap asking
// every laser for another minute.
export const LASER_POLL_MS = 3000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNumberOrNull = (value: unknown): value is number | null =>
  typeof value === 'number' || value === null;

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

const readDeviceJson = async (response: Response): Promise<Record<string, unknown>> => {
  const body = await response.text();

  if (!body) {
    throw new Error('The device closed the connection without returning a response.');
  }

  let result: unknown;

  try {
    result = JSON.parse(body);
  } catch {
    throw new Error('The device returned an invalid response.');
  }

  if (!isObject(result)) {
    throw new Error('The device returned an invalid response.');
  }

  return result;
};

const readChosenLaser = (value: unknown): ChosenLaser | null => {
  if (value === null) {
    return null;
  }

  if (!isChosenLaser(value)) {
    throw new Error('The device returned an invalid response.');
  }

  return value;
};

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

let developmentChoice: ChosenLaser | null = {
  number: 2,
  address: 'AA:00:00:00:00:02',
  mode: 'smart',
};

const developmentDelay = () => new Promise((resolve) => window.setTimeout(resolve, 300));

export const fetchLasers = async (): Promise<LaserList> => {
  if (import.meta.env.DEV) {
    await developmentDelay();
    return { laser: developmentChoice, lasers: developmentLasers };
  }

  const response = await fetch('/lasers', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`The device answered with status ${response.status}.`);
  }

  const result = await readDeviceJson(response);

  if (!Array.isArray(result.lasers) || !result.lasers.every(isLaserItem)) {
    throw new Error('The device returned an invalid response.');
  }

  return { laser: readChosenLaser(result.laser), lasers: result.lasers };
};

// The chosen laser from GET /status, which (unlike GET /lasers) doesn't start
// a search.
export const fetchChosenLaser = async (): Promise<ChosenLaser | null> => {
  if (import.meta.env.DEV) {
    await developmentDelay();
    return developmentChoice;
  }

  const response = await fetch('/status', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`The device answered with status ${response.status}.`);
  }

  const result = await readDeviceJson(response);

  return readChosenLaser(result.laser);
};

export const chooseLaser = async (address: string, mode: ChosenMode): Promise<ChosenLaser> => {
  if (import.meta.env.DEV) {
    await developmentDelay();
    const laser = developmentLasers.find((item) => item.address === address);
    developmentChoice = { number: laser?.number ?? null, address, mode };
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

  const chosen = readChosenLaser(result.laser);

  if (!chosen) {
    throw new Error('The device returned an invalid response.');
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
