import { useEffect, useRef, useState } from 'react';
import { Ban, Check, CircleAlert, LoaderCircle } from 'lucide-react';

import {
  LASER_POLL_MS,
  chooseLaser,
  fetchLasers,
  formatAgo,
  formatReading,
  laserName,
  modeLabel,
  modeMismatch,
  NO_LASER,
  type ChosenMode,
  type LaserItem,
  type LaserList,
  type TapLaser,
} from './lasers';
import type { LaserPick } from './laser-pick';
import './laser-picker.style.css';

const MODES: ChosenMode[] = ['smart', 'eco'];

const MODE_DESCRIPTIONS: Record<ChosenMode, string> = {
  smart: 'Screen a few minutes behind a pour. The RAPT app works. Batteries changed more often.',
  eco: 'Ultra Low Power. Batteries last longer. Screen up to about an hour behind.',
};

// The dots painted on the laser, so it can be matched to the one in the keg.
export const LaserDots = ({ number }: { number: number | null }) => (
  <span className="laser-dots" aria-hidden="true">
    {number === null ? (
      <span className="laser-dots-unknown">?</span>
    ) : (
      Array.from({ length: number }, (_, index) => <span className="laser-dot" key={index} />)
    )}
  </span>
);

const describeLaser = (laser: LaserItem) => {
  if (laser.lastHeardSeconds === null) {
    return 'Not heard yet';
  }

  const heard = `heard ${formatAgo(laser.lastHeardSeconds)}`;

  return laser.reading ? `${formatReading(laser.reading)} · ${heard}` : `No reading yet · ${heard}`;
};

// Lists the tap's lasers and holds the choice until save() sends it, or pick()
// hands it to a page that sends it later. start is that page's choice, if it
// isn't the tap's. While the component using it is mounted, it asks for the list
// every few seconds, which keeps the tap asking every laser for readings, not
// just the chosen one.
export const useLaserPicker = (start: { address: string; mode: ChosenMode } | null = null) => {
  const [list, setList] = useState<LaserList | null>(null);
  const [loadError, setLoadError] = useState('');
  // The choice not saved yet; null while it's the saved one.
  const [draftAddress, setDraftAddress] = useState<string | null>(start?.address ?? null);
  const [draftMode, setDraftMode] = useState<ChosenMode | null>(start?.mode ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const saveCount = useRef(0);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    const poll = async () => {
      // A hidden page shouldn't keep every laser answering.
      if (document.visibilityState !== 'hidden') {
        const savesBefore = saveCount.current;

        try {
          const next = await fetchLasers();

          if (stopped) {
            return;
          }

          // A save that finished during the request is newer than its answer.
          const stale = saveCount.current !== savesBefore;

          setList((previous) =>
            stale
              ? { ...next, laser: previous?.laser ?? null, noLaser: previous?.noLaser ?? false }
              : next
          );
          setLoadError('');
        } catch (error) {
          if (stopped) {
            return;
          }

          setLoadError(error instanceof Error ? error.message : 'Unable to list the lasers.');
        }
      }

      if (!stopped) {
        timer = window.setTimeout(() => void poll(), LASER_POLL_MS);
      }
    };

    void poll();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  const saved = list?.laser ?? null;
  // NO_LASER when the tap has no laser on purpose
  const savedAddress = list?.noLaser ? NO_LASER : (saved?.address ?? null);
  const address = draftAddress ?? savedAddress;
  const mode = draftMode ?? saved?.mode ?? 'smart';
  const changed =
    address !== null &&
    (address !== savedAddress || (address !== NO_LASER && mode !== saved?.mode));

  const selectLaser = (laser: LaserItem) => {
    setDraftAddress(laser.address);
    setSaveError('');
  };

  const selectNoLaser = () => {
    setDraftAddress(NO_LASER);
    setSaveError('');
  };

  const selectMode = (nextMode: ChosenMode) => {
    setDraftMode(nextMode);
    setSaveError('');
  };

  // The choice, with the laser's number and latest reading for a preview, or
  // null before there is one.
  const pick = (): LaserPick | null => {
    if (address === null) {
      return null;
    }

    const item = list?.lasers.find((laser) => laser.address === address);

    return {
      address,
      mode,
      number: item?.number ?? (saved?.address === address ? saved.number : null),
      reading: item?.reading ?? null,
    };
  };

  // Sends the choice to the tap. Returns what was saved, or null if it failed.
  const save = async (): Promise<TapLaser | null> => {
    if (!changed || saving || address === null) {
      return null;
    }

    setSaving(true);
    setSaveError('');

    try {
      const chosen = await chooseLaser(address, mode);

      saveCount.current++;
      setList((previous) => (previous ? { ...previous, ...chosen } : previous));
      setDraftAddress(null);
      setDraftMode(null);

      return chosen;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save the laser.');

      return null;
    } finally {
      setSaving(false);
    }
  };

  return {
    list,
    loadError,
    saved,
    address,
    mode,
    changed,
    saving,
    saveError,
    selectLaser,
    selectNoLaser,
    selectMode,
    pick,
    save,
  };
};

export type LaserPickerState = ReturnType<typeof useLaserPicker>;

// Draws useLaserPicker's lasers and modes. The page using it adds the Save
// button and shows saveError beside it.
export const LaserPicker = ({ picker }: { picker: LaserPickerState }) => {
  const { list, loadError, address, mode, saving, selectLaser, selectNoLaser, selectMode } = picker;
  const noLaser = address === NO_LASER;
  const someNotHeard = list?.lasers.some((laser) => laser.lastHeardSeconds === null) ?? false;

  return (
    <div className="laser-picker">
      <div className="laser-picker-heading">
        <span className="laser-picker-label" id="laser-list-label">
          Laser
        </span>
        <span className="laser-searching">
          <LoaderCircle className="laser-spinner" size={13} aria-hidden="true" />
          Searching
        </span>
      </div>

      {list === null ? (
        !loadError && <p className="laser-picker-note">Looking for lasers…</p>
      ) : (
        <div className="laser-options" role="group" aria-labelledby="laser-list-label">
          {/* First, as the dots count up from none */}
          <button
            className="laser-option"
            type="button"
            aria-pressed={noLaser}
            disabled={saving}
            onClick={selectNoLaser}
          >
            <span className="laser-dots" aria-hidden="true">
              <Ban size={16} />
            </span>
            <span className="laser-option-text">
              <span className="laser-option-name">
                <strong>No laser</strong>
              </span>
              <span className="laser-option-detail">
                For a tap without one. Its picture fills the whole screen, with no strip.
              </span>
            </span>
            <span className="laser-option-state" aria-hidden="true">
              {noLaser && <Check size={18} />}
            </span>
          </button>
          {list.lasers.length === 0 && (
            <p className="laser-picker-note">This tap doesn't know any lasers yet.</p>
          )}
          {list.lasers.map((laser) => {
            const selected = address === laser.address;
            const mismatch = selected ? modeMismatch(laser.reading, mode) : null;

            return (
              <button
                className="laser-option"
                key={laser.address}
                type="button"
                aria-pressed={selected}
                disabled={saving}
                onClick={() => selectLaser(laser)}
              >
                <LaserDots number={laser.number} />
                <span className="laser-option-text">
                  <span className="laser-option-name">
                    <strong>{laserName(laser)}</strong>
                    <small>{laser.address}</small>
                  </span>
                  <span className="laser-option-detail">{describeLaser(laser)}</span>
                  {mismatch && (
                    <span className="laser-option-warning">
                      <CircleAlert size={14} aria-hidden="true" />
                      {mismatch}
                    </span>
                  )}
                </span>
                <span className="laser-option-state" aria-hidden="true">
                  {selected && <Check size={18} />}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {someNotHeard && (
        <p className="laser-picker-note">
          A laser in Eco can take up to an hour to be heard. Check the dots on its lid.
        </p>
      )}

      {loadError && (
        <p className="laser-picker-error" role="alert">
          {loadError}
        </p>
      )}

      {!noLaser && (
        <>
          <div className="laser-picker-heading">
            <span className="laser-picker-label" id="laser-mode-label">
              Mode
            </span>
          </div>
          <div className="laser-modes" role="group" aria-labelledby="laser-mode-label">
            {MODES.map((option) => (
              <button
                className="laser-mode"
                key={option}
                type="button"
                aria-pressed={mode === option}
                disabled={list === null || saving}
                onClick={() => selectMode(option)}
              >
                <strong>{modeLabel(option)}</strong>
                <small>{MODE_DESCRIPTIONS[option]}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
