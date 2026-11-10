// Developer mode's test values under the preview, and the countdown while the tap
// shows test values, with "Back to live".
import { useEffect, useEffectEvent, useState } from 'react';

import {
  formatCountdown,
  TEST_SECONDS,
  withLitres,
  withPercent,
  type TestInputs,
} from './test-values';

const DEVELOPER_MODE_KEY = 'developerMode';

// Developer mode, remembered by this browser. Each tap's page is its own site to
// the browser, so each tap remembers it separately. Off if the browser keeps
// nothing, as in a private window.
export const loadDeveloperMode = () => {
  try {
    return window.localStorage.getItem(DEVELOPER_MODE_KEY) === 'on';
  } catch {
    return false;
  }
};

export const saveDeveloperMode = (on: boolean) => {
  try {
    if (on) {
      window.localStorage.setItem(DEVELOPER_MODE_KEY, 'on');
    } else {
      window.localStorage.removeItem(DEVELOPER_MODE_KEY);
    }
  } catch {
    // Not remembered: it's still on for this page.
  }
};

// Counts down to endsAt each second, and calls onEnd when it gets there.
const Countdown = ({ endsAt, onEnd }: { endsAt: number; onEnd: () => void }) => {
  const [now, setNow] = useState(() => Date.now());
  const secondsLeft = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const ended = useEffectEvent(onEnd);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (secondsLeft === 0) {
      ended();
    }
  }, [secondsLeft]);

  return <strong>{formatCountdown(Math.min(secondsLeft, TEST_SECONDS))}</strong>;
};

type TestValuesPanelProps = {
  developerMode: boolean;
  inputs: TestInputs;
  onInputsChange: (inputs: TestInputs) => void;
  // Why the typed values can't be sent.
  errors: string[];
  // When the tap's test values end, or null while it shows the laser's.
  endsAt: number | null;
  sending: 'show' | 'live' | null;
  sendError: string;
  onShow: () => void;
  onLive: () => void;
  // The countdown got to 0.
  onEnd: () => void;
};

export const TestValuesPanel = ({
  developerMode,
  inputs,
  onInputsChange,
  errors,
  endsAt,
  sending,
  sendError,
  onShow,
  onLive,
  onEnd,
}: TestValuesPanelProps) => {
  const change = (changes: Partial<TestInputs>) => onInputsChange({ ...inputs, ...changes });
  const percent = Number(inputs.percent);

  return (
    <section className="test-values" aria-label="Test values">
      {developerMode && (
        <>
          <div className="test-values-heading">
            <h3>Test values</h3>
            <span className="upload-label">Developer mode</span>
          </div>
          <p className="test-values-hint">
            The preview shows these. Show on device puts them on the screen for 5 minutes, with a
            red border, then the tap goes back to the laser's values.
          </p>
          <div className="test-values-fields">
            <div className="text-field test-percent-field">
              <span id="test-percent-label">Percentage</span>
              <div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  aria-labelledby="test-percent-label"
                  value={Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : 0}
                  onChange={(event) => onInputsChange(withPercent(inputs, event.target.value))}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  aria-labelledby="test-percent-label"
                  value={inputs.percent}
                  onChange={(event) => onInputsChange(withPercent(inputs, event.target.value))}
                />
              </div>
            </div>
            <label className="text-field">
              Litres
              <input
                type="number"
                min={0}
                max={19}
                step={0.1}
                value={inputs.litres}
                onChange={(event) => onInputsChange(withLitres(inputs, event.target.value))}
              />
            </label>
            <label className="text-field">
              Temperature °C
              <input
                type="number"
                min={-20}
                max={50}
                step={0.1}
                value={inputs.temperature}
                onChange={(event) => change({ temperature: event.target.value })}
              />
            </label>
            <label className="text-field">
              Battery %
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={inputs.battery}
                onChange={(event) => change({ battery: event.target.value })}
              />
            </label>
          </div>
          <div className="test-values-options">
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={inputs.modeWarning}
                onChange={(event) => change({ modeWarning: event.target.checked })}
              />
              Mode warning
            </label>
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={inputs.noSignal}
                onChange={(event) => change({ noSignal: event.target.checked })}
              />
              No signal
            </label>
          </div>
          {inputs.modeWarning && inputs.noSignal && (
            <p className="test-values-hint">
              No signal hides the mode warning, as it does on the tap.
            </p>
          )}
          {errors.map((error) => (
            <p key={error} className="message error-message">
              {error}
            </p>
          ))}
        </>
      )}
      <div className="test-values-actions">
        {developerMode && (
          <button
            className="modal-button primary-modal-button"
            type="button"
            disabled={errors.length > 0 || sending !== null}
            onClick={onShow}
          >
            {sending === 'show' ? 'Sending…' : 'Show on device'}
          </button>
        )}
        {endsAt !== null && (
          <>
            <p className="test-countdown">
              Test values on the screen for <Countdown endsAt={endsAt} onEnd={onEnd} />
            </p>
            <button
              className="modal-button"
              type="button"
              disabled={sending !== null}
              onClick={onLive}
            >
              {sending === 'live' ? 'Going back…' : 'Back to live'}
            </button>
          </>
        )}
      </div>
      {sendError && (
        <p className="message error-message" role="alert">
          {sendError}
        </p>
      )}
    </section>
  );
};
