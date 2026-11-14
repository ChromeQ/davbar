// Developer mode's test values under the preview, and the countdown while the tap
// shows test values, with "Back to live".
import { useEffect, useEffectEvent, useState } from 'react';

import { SETUP_HELP_SCREENS } from './setup-help';
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
  // The tap shows the setup help with them.
  showingSetupHelp: boolean;
  // No laser on purpose, the tap's or picked: there's no strip to test, so only
  // the setup help is shown, on its own.
  noLaser: boolean;
  // A laser picked for the preview that Upload to display hasn't sent. Show on
  // device tests with it, and the tap keeps its own.
  laserPicked: boolean;
  // Why the preview can't show the chosen setup help.
  setupHelpError: string;
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
  showingSetupHelp,
  noLaser,
  laserPicked,
  setupHelpError,
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
          {noLaser ? (
            <p className="test-values-hint">
              With no laser, the picture fills the whole screen and there's no strip to test. The
              setup help can still be previewed and shown on the screen.
            </p>
          ) : (
            <>
              <p className="test-values-hint">
                The preview shows these. Show on device puts them on the screen for 5 minutes, with
                a red border, then the tap goes back to the laser's values.
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
                      disabled={inputs.noReading}
                      onChange={(event) => onInputsChange(withPercent(inputs, event.target.value))}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      aria-labelledby="test-percent-label"
                      value={inputs.percent}
                      disabled={inputs.noReading}
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
                    disabled={inputs.noReading}
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
                    disabled={inputs.noReading}
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
                    disabled={inputs.noReading}
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
                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={inputs.noReading}
                    onChange={(event) => change({ noReading: event.target.checked })}
                  />
                  No reading
                </label>
              </div>
              {inputs.modeWarning && inputs.noSignal && (
                <p className="test-values-hint">
                  No signal hides the mode warning, as it does on the tap.
                </p>
              )}
              {inputs.noReading && (
                <p className="test-values-hint">
                  No reading shows the strip waiting for the laser, or not hearing it with No
                  signal, so the numbers aren't used.
                </p>
              )}
            </>
          )}
          <div className="test-setup-help">
            <span id="setup-help-label">Setup help</span>
            <div className="mode-switch" role="group" aria-labelledby="setup-help-label">
              {[{ screen: null, label: 'Off' }, ...SETUP_HELP_SCREENS].map(({ screen, label }) => (
                <button
                  key={label}
                  className={inputs.setupHelp === screen ? 'active' : ''}
                  type="button"
                  aria-pressed={inputs.setupHelp === screen}
                  onClick={() => change({ setupHelp: screen })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {inputs.setupHelp && (
            <p className="test-values-hint">
              What the tap shows in place of a picture while it has none:{' '}
              {inputs.setupHelp === 'join'
                ? 'before its Wi-Fi is set up.'
                : 'on Wi-Fi, until the first picture.'}{' '}
              The preview is the tap's own drawing, with the password left out. Show on device puts
              it on the screen{noLaser ? '' : ' with the test values'}.
            </p>
          )}
          {setupHelpError && (
            <p className="message error-message" role="alert">
              {setupHelpError}
            </p>
          )}
          {!noLaser &&
            errors.map((error) => (
              <p key={error} className="message error-message">
                {error}
              </p>
            ))}
          {laserPicked && (
            <p className="test-values-hint">
              Show on device tests with the laser picked. The tap keeps its own until Upload to
              display sends it.
            </p>
          )}
        </>
      )}
      <div className="test-values-actions">
        {developerMode && (
          <button
            className="modal-button primary-modal-button"
            type="button"
            disabled={(noLaser ? !inputs.setupHelp : errors.length > 0) || sending !== null}
            onClick={onShow}
          >
            {sending === 'show' ? 'Sending…' : 'Show on device'}
          </button>
        )}
        {endsAt !== null && (
          <>
            <p className="test-countdown">
              {showingSetupHelp
                ? noLaser
                  ? 'Setup help'
                  : 'Setup help and test values'
                : 'Test values'}{' '}
              on the screen for <Countdown endsAt={endsAt} onEnd={onEnd} />
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
