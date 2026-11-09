// What the tap's strip shows: GET /strip gives the values it would draw now, for
// the preview, and how long test values from "Show on device" have left.
import { useEffect, useState } from 'react';

import { developmentDelay, isNumberOrNull, isObject, readDeviceJson } from './device-json';
import type { StripValues } from './strip';

// How often the preview asks. The strip changes every few minutes at most.
export const STRIP_POLL_MS = 15000;

export type StripState = {
  values: StripValues;
  // null when the strip shows the laser's values.
  testSecondsLeft: number | null;
};

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
};

export const fetchStrip = async (): Promise<StripState> => {
  if (import.meta.env.DEV) {
    await developmentDelay();
    return developmentState;
  }

  const response = await fetch('/strip', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`The device answered with status ${response.status}.`);
  }

  const result = await readDeviceJson(response);

  if (!isStripValues(result.values) || !isNumberOrNull(result.testSecondsLeft)) {
    throw new Error('The device returned an invalid response.');
  }

  return { values: result.values, testSecondsLeft: result.testSecondsLeft };
};

// The strip's values, asked for every STRIP_POLL_MS while the page is showing.
// strip is null until the first answer; error says why the last one failed.
export const useStripState = () => {
  const [strip, setStrip] = useState<StripState | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    const poll = async () => {
      if (document.visibilityState !== 'hidden') {
        try {
          const next = await fetchStrip();

          if (!stopped) {
            setStrip(next);
            setError('');
          }
        } catch (fetchError) {
          if (!stopped) {
            setError(
              fetchError instanceof Error ? fetchError.message : 'Unable to read the strip.'
            );
          }
        }
      }

      if (!stopped) {
        timer = window.setTimeout(() => void poll(), STRIP_POLL_MS);
      }
    };

    void poll();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  return { strip, error };
};
