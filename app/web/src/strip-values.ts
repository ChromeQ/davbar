// What the tap's strip shows: GET /strip gives the values it would draw now, for
// the preview, and how long test values from "Show on device" have left.
import { useCallback, useEffect, useRef, useState } from 'react';

import { developmentDelay, isNumberOrNull, isObject, readDeviceJson } from './device-json';
import type { LaserPick } from './laser-pick';
import { developmentTapLaser, readTapLaser, type TapLaser } from './lasers';
import type { StripValues } from './strip';
import { setupHelpTestForm, TEST_SECONDS, testForm, type SetupHelpScreen } from './test-values';

// How often the preview asks. The strip changes every few minutes at most.
export const STRIP_POLL_MS = 15000;

export type StripState = {
  values: StripValues;
  // null when the strip shows the laser's values.
  testSecondsLeft: number | null;
  // The setup help screen showing with the test values, or null.
  setupHelp: SetupHelpScreen | null;
  // The tap's laser, so a choice made from another page shows, or null from older
  // firmware.
  tapLaser: TapLaser | null;
};

const asSetupHelp = (value: unknown): SetupHelpScreen | null =>
  value === 'join' || value === 'ready' ? value : null;

export const isStripValues = (value: unknown): value is StripValues =>
  isObject(value) &&
  typeof value.laserChosen === 'boolean' &&
  typeof value.laserNumber === 'number' &&
  (value.mode === 'smart' || value.mode === 'eco') &&
  isNumberOrNull(value.percent) &&
  isNumberOrNull(value.litresTenths) &&
  isNumberOrNull(value.temperatureTenths) &&
  isNumberOrNull(value.batteryPercent) &&
  typeof value.modeWarning === 'boolean' &&
  typeof value.noSignal === 'boolean' &&
  typeof value.test === 'boolean';

// Made-up values for `pnpm dev`, where there is no device.
const developmentState: StripState = {
  values: {
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
  },
  testSecondsLeft: null,
  setupHelp: null,
  tapLaser: null,
};

// Test values on the made-up tap, or null for the setup help alone, and when
// they end.
let developmentTest: {
  values: StripValues | null;
  setupHelp: SetupHelpScreen | null;
  endsAt: number;
} | null = null;

const developmentStrip = (): StripState => {
  if (developmentTest && Date.now() >= developmentTest.endsAt) {
    developmentTest = null;
  }

  // The made-up laser's choice, so choosing one shows
  const tapLaser = developmentTapLaser();
  const live: StripValues = {
    ...developmentState.values,
    laserChosen: tapLaser.laser !== null,
    laserNumber: tapLaser.laser?.number ?? 0,
    mode: tapLaser.laser?.mode ?? 'smart',
  };

  return developmentTest
    ? {
        values: developmentTest.values ? { ...developmentTest.values, test: true } : live,
        testSecondsLeft: Math.ceil((developmentTest.endsAt - Date.now()) / 1000),
        setupHelp: developmentTest.setupHelp,
        tapLaser,
      }
    : { ...developmentState, values: live, tapLaser };
};

export const fetchStrip = async (): Promise<StripState> => {
  if (import.meta.env.DEV) {
    await developmentDelay();
    return developmentStrip();
  }

  const response = await fetch('/strip', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`The device answered with status ${response.status}.`);
  }

  const result = await readDeviceJson(response);

  if (!isStripValues(result.values) || !isNumberOrNull(result.testSecondsLeft)) {
    throw new Error('The device returned an invalid response.');
  }

  return {
    values: result.values,
    testSecondsLeft: result.testSecondsLeft,
    setupHelp: asSetupHelp(result.setupHelp),
    tapLaser: readTapLaser(result),
  };
};

// Sends a POST to the tap, throwing its message if it turns the request down.
const postToTap = async (path: string, body?: URLSearchParams) => {
  const response = await fetch(path, { method: 'POST', body });
  const result = await readDeviceJson(response);

  if (!response.ok || result.success !== true) {
    throw new Error(
      typeof result.message === 'string' && result.message
        ? result.message
        : `The device answered with status ${response.status}.`
    );
  }
};

// "Show on device": the tap shows these test values for TEST_SECONDS, with the
// setup help in place of the picture if asked. noReading shows the strip waiting
// for the laser. pick, a laser picked in the preview and not sent yet, is tested
// with in place of the tap's own.
export const showTestValues = async (
  values: StripValues,
  setupHelp: SetupHelpScreen | null = null,
  noReading = false,
  pick: LaserPick | null = null
) => {
  const form = testForm(values, setupHelp, noReading, pick);

  if (!form) {
    throw new Error('The test values are not complete.');
  }

  if (import.meta.env.DEV) {
    await developmentDelay();
    developmentTest = { values, setupHelp, endsAt: Date.now() + TEST_SECONDS * 1000 };
    return;
  }

  await postToTap('/strip/test', form);
};

// "Show on device" with no laser on purpose, the tap's or picked in the preview,
// which has no strip to test: the setup help alone, on the whole screen, for
// TEST_SECONDS.
export const showSetupHelpTest = async (
  setupHelp: SetupHelpScreen,
  pick: LaserPick | null = null
) => {
  if (import.meta.env.DEV) {
    await developmentDelay();
    developmentTest = { values: null, setupHelp, endsAt: Date.now() + TEST_SECONDS * 1000 };
    return;
  }

  await postToTap('/strip/test', setupHelpTestForm(setupHelp, pick));
};

// "Back to live": the tap goes back to the laser's values.
export const showLiveValues = async () => {
  if (import.meta.env.DEV) {
    await developmentDelay();
    developmentTest = null;
    return;
  }

  await postToTap('/strip/live');
};

// The strip's values, asked for every STRIP_POLL_MS while the page is showing, and
// straight away by refresh(). strip is null until the first answer, and
// receivedAt is when that answer arrived; error says why the last one failed.
export const useStripState = () => {
  const [strip, setStrip] = useState<(StripState & { receivedAt: number }) | null>(null);
  const [error, setError] = useState('');
  const pollNow = useRef(() => {});

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    // Counts polls, so when refresh() starts one while another is waiting, only
    // the newer one's answer is used and only it carries on polling.
    let pollCount = 0;

    const poll = async () => {
      const thisPoll = ++pollCount;
      const isLatest = () => !stopped && thisPoll === pollCount;

      window.clearTimeout(timer);

      if (document.visibilityState !== 'hidden') {
        try {
          const next = await fetchStrip();

          if (isLatest()) {
            setStrip({ ...next, receivedAt: Date.now() });
            setError('');
          }
        } catch (fetchError) {
          if (isLatest()) {
            setError(
              fetchError instanceof Error ? fetchError.message : 'Unable to read the strip.'
            );
          }
        }
      }

      if (isLatest()) {
        timer = window.setTimeout(() => void poll(), STRIP_POLL_MS);
      }
    };

    pollNow.current = () => void poll();
    void poll();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      pollNow.current = () => {};
    };
  }, []);

  const refresh = useCallback(() => pollNow.current(), []);

  return { strip, error, refresh };
};
