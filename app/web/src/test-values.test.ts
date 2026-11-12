import { describe, expect, it } from 'vitest';

import {
  BATTERY_ERROR,
  DEFAULT_TEST_INPUTS,
  formatCountdown,
  LITRES_ERROR,
  PERCENT_ERROR,
  PICK_UP_MS,
  readTestInputs,
  showsSetupHelp,
  TEMPERATURE_ERROR,
  TEST_SECONDS,
  testEndsAt,
  testForm,
  withLitres,
  withPercent,
  type TestInputs,
} from './test-values';

const tap = { laserNumber: 2, mode: 'eco' } as const;
const read = (changes: Partial<TestInputs>) =>
  readTestInputs({ ...DEFAULT_TEST_INPUTS, ...changes }, tap);

describe('reading the test values', () => {
  it("draws them with the tap's laser dots and mode icon, and the red border", () => {
    const { strip, errors } = read({
      percent: '62',
      litres: '11.8',
      temperature: '18.3',
      battery: '9',
      modeWarning: true,
    });

    expect(errors).toEqual([]);
    expect(strip).toEqual({
      laserChosen: true,
      laserNumber: 2,
      mode: 'eco',
      percent: 62,
      litresTenths: 118,
      temperatureTenths: 183,
      batteryPercent: 9,
      modeWarning: true,
      noSignal: false,
      test: true,
    });
  });

  it("works out the litres from the percentage for a 19 L keg, rounded down like the tap's", () => {
    const litres = (percent: string) => withPercent(DEFAULT_TEST_INPUTS, percent).litres;

    expect(litres('100')).toBe('19.0');
    expect(litres('62')).toBe('11.7');
    expect(litres('63')).toBe('11.9');
    expect(litres('1')).toBe('0.1');
    expect(litres('0')).toBe('0.0');
  });

  it('works out the percentage a real reading shows with the typed litres', () => {
    const percent = (litres: string) => withLitres(DEFAULT_TEST_INPUTS, litres).percent;

    // No percentage gives 11.8 L, but a real reading of 62.1% does.
    expect(percent('11.8')).toBe('62');
    expect(percent('19')).toBe('100');
    expect(percent('0.1')).toBe('0');
    expect(percent('5.7')).toBe('30');
  });

  it('leaves the other box alone until the typed one is a number the tap takes', () => {
    expect(withPercent(DEFAULT_TEST_INPUTS, '1')).toMatchObject({ percent: '1', litres: '0.1' });
    expect(withPercent(DEFAULT_TEST_INPUTS, '')).toMatchObject({ percent: '', litres: '14.2' });
    expect(withLitres(DEFAULT_TEST_INPUTS, '19.5')).toMatchObject({
      percent: '75',
      litres: '19.5',
    });
    expect(withLitres(DEFAULT_TEST_INPUTS, '12.')).toMatchObject({ percent: '63', litres: '12.' });
  });

  it('takes temperatures below zero, rounded to tenths', () => {
    expect(read({ temperature: '-2.5' }).strip.temperatureTenths).toBe(-25);
    expect(read({ temperature: '3.96' }).strip.temperatureTenths).toBe(40);
    expect(read({ temperature: '-0.01' }).strip.temperatureTenths).toBe(0);
    expect(read({ temperature: ' 50 ' }).strip.temperatureTenths).toBe(500);
  });

  it("leaves off what the tap would turn down, with the tap's message", () => {
    const { strip, errors } = read({
      percent: '101',
      litres: '19.1',
      temperature: '',
      battery: '50.5',
    });

    expect(strip.percent).toBeNull();
    expect(strip.litresTenths).toBeNull();
    expect(strip.temperatureTenths).toBeNull();
    expect(strip.batteryPercent).toBeNull();
    expect(errors).toEqual([PERCENT_ERROR, LITRES_ERROR, TEMPERATURE_ERROR, BATTERY_ERROR]);
  });

  it('turns down numbers outside the limits or not written plainly', () => {
    expect(read({ percent: '-1' }).errors).toEqual([PERCENT_ERROR]);
    expect(read({ litres: '-0.1' }).errors).toEqual([LITRES_ERROR]);
    expect(read({ temperature: '-20.1' }).errors).toEqual([TEMPERATURE_ERROR]);
    expect(read({ temperature: '1e1' }).errors).toEqual([TEMPERATURE_ERROR]);
    expect(read({ battery: 'full' }).errors).toEqual([BATTERY_ERROR]);
  });
});

describe('the form for the tap', () => {
  it('sends tenths as a decimal, and the icons as true or false', () => {
    const form = testForm(read({ temperature: '-2', noSignal: true }).strip);

    expect(form?.toString()).toBe(
      'percent=75&litres=14.2&temperature=-2.0&battery=100&modeWarning=false&noSignal=true'
    );
  });

  it('is not made while a value is missing', () => {
    expect(testForm(read({ percent: '' }).strip)).toBeNull();
    expect(testForm(read({ litres: '' }).strip)).toBeNull();
  });

  it('asks for the setup help in place of the picture only when one is chosen', () => {
    const strip = read({}).strip;

    expect(testForm(strip, 'join')?.get('setupHelp')).toBe('join');
    expect(testForm(strip, 'ready')?.get('setupHelp')).toBe('ready');
    expect(testForm(strip, null)?.has('setupHelp')).toBe(false);
  });
});

describe('when the test values end', () => {
  const at = 1_000_000;
  const report = (testSecondsLeft: number | null, receivedAt: number) => ({
    testSecondsLeft,
    receivedAt,
  });

  it("goes by the tap's countdown", () => {
    expect(testEndsAt(report(120, at), null)).toBe(at + 120_000);
    expect(testEndsAt(report(null, at), null)).toBeNull();
    expect(testEndsAt(null, null)).toBeNull();
  });

  it('counts from Show on device until the tap says it shows them', () => {
    const show = { kind: 'show' as const, at };

    // Asked before, or by a tap still redrawing
    expect(testEndsAt(report(null, at - 5_000), show)).toBe(at + TEST_SECONDS * 1000);
    expect(testEndsAt(report(30, at - 5_000), show)).toBe(at + TEST_SECONDS * 1000);
    expect(testEndsAt(report(null, at + 20_000), show)).toBe(at + TEST_SECONDS * 1000);
    // The tap shows them
    expect(testEndsAt(report(299, at + 2_000), show)).toBe(at + 2_000 + 299_000);
    // The tap still doesn't show them after a redraw's time
    expect(testEndsAt(report(null, at + PICK_UP_MS), show)).toBeNull();
  });

  it('stops at Back to live, unless the tap still shows them after a redraw', () => {
    const live = { kind: 'live' as const, at };

    expect(testEndsAt(report(200, at - 5_000), live)).toBeNull();
    expect(testEndsAt(report(190, at + 10_000), live)).toBeNull();
    expect(testEndsAt(report(null, at + 1_000), live)).toBeNull();
    expect(testEndsAt(report(140, at + PICK_UP_MS), live)).toBe(at + PICK_UP_MS + 140_000);
  });
});

describe('whether the tap shows the setup help', () => {
  const at = 1_000_000;
  const report = (setupHelp: 'join' | 'ready' | null, receivedAt: number) => ({
    setupHelp,
    receivedAt,
  });

  it('goes by the tap, and by the request until the tap has picked it up', () => {
    const show = { kind: 'show' as const, at, setupHelp: 'join' as const };

    expect(showsSetupHelp(report('ready', at), null)).toBe(true);
    expect(showsSetupHelp(null, show)).toBe(true);
    // Not picked up yet, then picked up
    expect(showsSetupHelp(report(null, at + 2_000), show)).toBe(true);
    expect(showsSetupHelp(report('join', at + 2_000), show)).toBe(true);
    // Still not shown after a redraw's time
    expect(showsSetupHelp(report(null, at + PICK_UP_MS), show)).toBe(false);
    // Test values alone, and Back to live
    expect(showsSetupHelp(report(null, at + 2_000), { kind: 'show', at })).toBe(false);
    expect(showsSetupHelp(report('join', at + 2_000), { kind: 'live', at })).toBe(false);
  });
});

it('formats the countdown in minutes and seconds', () => {
  expect(formatCountdown(300)).toBe('5:00');
  expect(formatCountdown(65)).toBe('1:05');
  expect(formatCountdown(0)).toBe('0:00');
});
