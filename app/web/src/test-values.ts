// Developer mode's test values: made-up numbers for the strip, drawn in the
// preview and sent to the tap by "Show on device" to check them on the real
// screen. The tap's side is showTestValues in esp32/src/StripManager.cpp.
import type { StripValues } from './strip';

// The fields as typed, so a number part-way through being typed stays in its box.
export type TestInputs = {
  percent: string;
  litres: string;
  temperature: string;
  battery: string;
  modeWarning: boolean;
  noSignal: boolean;
};

export const DEFAULT_TEST_INPUTS: TestInputs = {
  percent: '75',
  litres: '14.2',
  temperature: '4.0',
  battery: '100',
  modeWarning: false,
  noSignal: false,
};

// How long the tap shows test values before going back to the laser's.
export const TEST_SECONDS = 5 * 60;

// The tap's keg: a 19 L Corny keg (RaptLaser::Corny19L).
const KEG_TENTHS_LITRES = 190;

// The tap's limits, and its messages for values outside them.
export const PERCENT_ERROR = 'The percentage must be a whole number from 0 to 100.';
export const LITRES_ERROR = 'The litres must be a number from 0 to 19.';
export const TEMPERATURE_ERROR = 'The temperature must be a number from -20 to 50.';
export const BATTERY_ERROR = 'The battery must be a whole number from 0 to 100.';

// A whole number in range, written plainly ("87").
const parseWhole = (text: string, min: number, max: number) => {
  const trimmed = text.trim();

  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);

  return value >= min && value <= max ? value : null;
};

// A number in range ("18.3"), rounded to tenths.
const parseTenths = (text: string, min: number, max: number) => {
  const trimmed = text.trim();

  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return null;
  }

  // + 0 turns -0 into 0.
  const tenths = Math.round(Number(trimmed) * 10) + 0;

  return tenths >= min * 10 && tenths <= max * 10 ? tenths : null;
};

// The litres the tap works out for a percentage, in tenths, rounded down like the
// laser's.
export const litresForPercent = (percent: number) =>
  Math.floor((KEG_TENTHS_LITRES * percent) / 100);

// The percentage a real reading shows with these litres. The laser works both
// out from the same level, rounding each down.
export const percentForLitres = (litresTenths: number) =>
  Math.floor((litresTenths * 100) / KEG_TENTHS_LITRES);

const formatTenths = (tenths: number) => (tenths / 10).toFixed(1);

// The percentage and litres are linked: typing either one works out the other,
// once it's a number the tap takes.
export const withPercent = (inputs: TestInputs, percent: string): TestInputs => {
  const value = parseWhole(percent, 0, 100);

  return {
    ...inputs,
    percent,
    litres: value === null ? inputs.litres : formatTenths(litresForPercent(value)),
  };
};

export const withLitres = (inputs: TestInputs, litres: string): TestInputs => {
  const tenths = parseTenths(litres, 0, 19);

  return {
    ...inputs,
    litres,
    percent: tenths === null ? inputs.percent : String(percentForLitres(tenths)),
  };
};

// What the tap's own strip has that test values keep: its laser dots and mode icon.
export type TapStrip = Pick<StripValues, 'laserNumber' | 'mode'>;

// The strip "Show on device" would draw, with the red border. A value that can't
// be sent is left off, and errors says why.
export const readTestInputs = (
  inputs: TestInputs,
  tap: TapStrip
): { strip: StripValues; errors: string[] } => {
  const percent = parseWhole(inputs.percent, 0, 100);
  const litresTenths = parseTenths(inputs.litres, 0, 19);
  const temperatureTenths = parseTenths(inputs.temperature, -20, 50);
  const batteryPercent = parseWhole(inputs.battery, 0, 100);
  const errors = [
    percent === null && PERCENT_ERROR,
    litresTenths === null && LITRES_ERROR,
    temperatureTenths === null && TEMPERATURE_ERROR,
    batteryPercent === null && BATTERY_ERROR,
  ].filter((error) => typeof error === 'string');

  return {
    strip: {
      laserChosen: true,
      laserNumber: tap.laserNumber,
      mode: tap.mode,
      percent,
      litresTenths,
      temperatureTenths,
      batteryPercent,
      modeWarning: inputs.modeWarning,
      noSignal: inputs.noSignal,
      test: true,
    },
    errors,
  };
};

// The form POST /strip/test takes, or null if a value is missing.
export const testForm = (strip: StripValues): URLSearchParams | null => {
  const { percent, litresTenths, temperatureTenths, batteryPercent } = strip;

  if (
    percent === null ||
    litresTenths === null ||
    temperatureTenths === null ||
    batteryPercent === null
  ) {
    return null;
  }

  return new URLSearchParams({
    percent: String(percent),
    litres: formatTenths(litresTenths),
    temperature: formatTenths(temperatureTenths),
    battery: String(batteryPercent),
    modeWarning: String(strip.modeWarning),
    noSignal: String(strip.noSignal),
  });
};

// The last "Show on device" or "Back to live" this page sent, and when.
export type TestRequest = { kind: 'show' | 'live'; at: number };

// What the tap last said about test values, and when its answer arrived.
export type TestReport = { testSecondsLeft: number | null; receivedAt: number };

// The tap picks requests up between redraws, so for a while after one its
// answers may not show it yet. A redraw takes well under this.
export const PICK_UP_MS = 60 * 1000;

// When the tap's test values end, by this browser's clock, or null when it shows
// the laser's values. Until the tap's answers show the last request, the request
// decides.
export const testEndsAt = (
  report: TestReport | null,
  request: TestRequest | null
): number | null => {
  const reported =
    report && report.testSecondsLeft !== null
      ? report.receivedAt + report.testSecondsLeft * 1000
      : null;

  if (!request) {
    return reported;
  }

  const requested = request.kind === 'show' ? request.at + TEST_SECONDS * 1000 : null;

  // Not answered since the request
  if (!report || report.receivedAt < request.at) {
    return requested;
  }

  const showsRequest = (reported !== null) === (request.kind === 'show');

  if (showsRequest || report.receivedAt >= request.at + PICK_UP_MS) {
    return reported;
  }

  return requested;
};

// "4:05"
export const formatCountdown = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
