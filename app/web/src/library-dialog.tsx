// The Library: every tap's beers in one grid, each once, last shown first.
// Picking one loads its picture into Compose, like choosing a file. The round
// tick in each beer's corner chooses beers to remove from every tap; once one is
// ticked, clicking any beer ticks it too.
//
// The keg states, Keg empty and Keg ready, come first: drawn here with the line
// each will get next (see keg-states.ts), and never removed.
//
// When a beer sent wasn't saved because this tap's library is full, the grid
// opens on this tap's beers, ready to choose which to remove to make room.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, Library, LoaderCircle } from 'lucide-react';

import { deviceConfig, type TapLink } from './device-config';
import {
  KEG_STATES,
  kegLines,
  kegStateName,
  kegStatePicture,
  lastLine,
  pickLine,
  rememberLine,
  type KegState,
} from './keg-states';
import {
  fetchBeerFile,
  fetchTapLibrary,
  formatLastShown,
  mergeLibraries,
  namesText,
  removalPlan,
  removalSummary,
  removeBeers,
  sourceTap,
  tapAddress,
  type LibraryBeer,
  type TapLibrary,
} from './library';

type TapState = {
  tap: TapLink;
  library: TapLibrary | null;
  failed: boolean;
};

type LibraryDialogProps = {
  onClose: () => void;
  // A beer was picked: its ID and picture.
  onPick: (beer: { id: string; picture: Blob }) => void;
  // A keg state was picked: its picture, drawn with today's date, and its line
  // and date, to draw it again on the whole screen of a tap with no laser.
  onPickKegState?: (pick: { state: KegState; line: string; date: Date; picture: Blob }) => void;
  // Set when making room for a beer this tap's full library turned away: called
  // once beers are gone from this tap, to save it.
  onMadeRoom?: () => Promise<void>;
};

const thisTapId = deviceConfig.deviceId;

// Every tap in config/, or just this one when it has no profiles beside it.
export const libraryTaps: TapLink[] =
  deviceConfig.taps.length > 0
    ? deviceConfig.taps
    : [
        {
          deviceName: deviceConfig.deviceName,
          deviceId: deviceConfig.deviceId,
          url: `${deviceConfig.uploadUrl}/`,
        },
      ];

// Where this page's tap takes beers to save.
// This page's tap, among them.
export const thisTap = libraryTaps.find((tap) => tap.deviceId === thisTapId) ?? libraryTaps[0]!;

export const thisTapLibrary = tapAddress(thisTap, thisTapId, 'library');

const beersText = (count: number) => `${count} ${count === 1 ? 'beer' : 'beers'}`;

type KegPicture = { line: string; date: Date; picture: Blob; url: string };

export const LibraryDialog = ({
  onClose,
  onPick,
  onPickKegState,
  onMadeRoom,
}: LibraryDialogProps) => {
  const makingRoom = onMadeRoom !== undefined;
  const [taps, setTaps] = useState<TapState[]>(() =>
    libraryTaps.map((tap) => ({ tap, library: null, failed: false }))
  );
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [kegPictures, setKegPictures] = useState<Partial<Record<KegState, KegPicture>>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  // What the last pick or removal came to.
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const mounted = useRef(true);
  // Thumbnails asked for, and the addresses made for them, freed on closing.
  const requested = useRef(new Set<string>());
  const thumbnailUrls = useRef<string[]>([]);

  // A new list only when a tap's answer arrives, so the thumbnails effect runs then.
  const beers = useMemo(
    () => mergeLibraries(taps.flatMap((state) => (state.library ? [state.library] : []))),
    [taps]
  );
  // Making room, only this tap's beers free any.
  const shownBeers = makingRoom
    ? beers.filter((beer) => beer.taps.some((tap) => tap.deviceId === thisTapId))
    : beers;
  const thisTap = taps.find((state) => state.tap.deviceId === thisTapId);
  const unreachable = taps.filter((state) => state.failed).map((state) => state.tap.deviceName);
  // Taps not answered yet. A tap that's off takes up to 6s to give up on.
  const asking = taps
    .filter((state) => !state.library && !state.failed)
    .map((state) => state.tap.deviceName);
  const loading = asking.length > 0;
  const busy = picking !== null || removing;
  // Choosing beers to remove: clicking a beer ticks it rather than loading it.
  const selecting = makingRoom || selected.length > 0;

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      thumbnailUrls.current.forEach((url) => URL.revokeObjectURL(url));
      thumbnailUrls.current = [];
    };
  }, []);

  // The keg states' pictures, with the line each will get next and today's date,
  // so the grid shows just what picking one loads. None when making room, as
  // they take no room.
  useEffect(() => {
    if (makingRoom) {
      return;
    }

    const today = new Date();

    for (const state of KEG_STATES) {
      const line = pickLine(kegLines[state], lastLine(state));

      kegStatePicture(state, line, today).then(
        (picture) => {
          if (mounted.current) {
            const url = URL.createObjectURL(picture);
            thumbnailUrls.current.push(url);
            setKegPictures((pictures) => ({
              ...pictures,
              [state]: { line, date: today, picture, url },
            }));
          }
        },
        () => {
          // Left as a blank square, which can't be picked.
        }
      );
    }
  }, [makingRoom]);

  // Each tap's list, all at once: each is one small request.
  useEffect(() => {
    libraryTaps.forEach((tap, index) => {
      fetchTapLibrary(tap, thisTapId).then(
        (library) => {
          if (mounted.current) {
            setTaps((states) =>
              states.map((state, at) => (at === index ? { ...state, library } : state))
            );
          }
        },
        () => {
          if (mounted.current) {
            setTaps((states) =>
              states.map((state, at) => (at === index ? { ...state, failed: true } : state))
            );
          }
        }
      );
    });
  }, []);

  // The thumbnails, one at a time from each tap, as each file a tap sends at the
  // same time costs it memory it can't spare. Browsers keep them for next time.
  // Each is asked for once, however often the list changes.
  useEffect(() => {
    const queues = new Map<string, { tap: TapLink; ids: string[] }>();

    for (const beer of beers) {
      if (requested.current.has(beer.id)) {
        continue;
      }

      requested.current.add(beer.id);
      const tap = sourceTap(beer, thisTapId);
      const queue = queues.get(tap.deviceId) ?? { tap, ids: [] };
      queue.ids.push(beer.id);
      queues.set(tap.deviceId, queue);
    }

    for (const { tap, ids } of queues.values()) {
      void (async () => {
        for (const id of ids) {
          if (!mounted.current) {
            return;
          }

          try {
            const blob = await fetchBeerFile(tap, thisTapId, id, 'thumbnail');
            const url = URL.createObjectURL(blob);
            thumbnailUrls.current.push(url);

            if (mounted.current) {
              setThumbnails((loaded) => ({ ...loaded, [id]: url }));
            }
          } catch {
            // Left as a blank square; the beer can still be picked.
          }
        }
      })();
    }
  }, [beers]);

  const pick = async (beer: LibraryBeer) => {
    setPicking(beer.id);
    setNotice(null);

    try {
      const picture = await fetchBeerFile(
        sourceTap(beer, thisTapId),
        thisTapId,
        beer.id,
        'picture'
      );
      onPick({ id: beer.id, picture });
    } catch (error) {
      if (mounted.current) {
        setNotice({
          text: `That beer couldn't be loaded: ${error instanceof Error ? error.message : 'no answer.'}`,
          error: true,
        });
      }
    } finally {
      if (mounted.current) {
        setPicking(null);
      }
    }
  };

  const toggle = (id: string) => {
    setSelected((chosen) =>
      chosen.includes(id) ? chosen.filter((each) => each !== id) : [...chosen, id]
    );
    setConfirming(false);
    setNotice(null);
  };

  const clearSelection = () => {
    setSelected([]);
    setConfirming(false);
  };

  // Removes the chosen beers from every tap that has them and can be reached.
  const remove = async () => {
    setRemoving(true);
    setNotice(null);

    const libraries = taps.flatMap((state) => (state.library ? [state.library] : []));
    const results = await Promise.all(
      removalPlan(libraries, selected).map(({ tap, ids }) => removeBeers(tap, thisTapId, ids))
    );

    if (!mounted.current) {
      return;
    }

    setTaps((states) =>
      states.map((state) => {
        const result = results.find((each) => each.tap.deviceId === state.tap.deviceId);

        return result && state.library
          ? {
              ...state,
              library: {
                ...state.library,
                beers: state.library.beers.filter((beer) => !result.removed.includes(beer.id)),
              },
            }
          : state;
      })
    );
    setNotice({
      text: removalSummary(results, unreachable),
      error: results.some((result) => result.error),
    });
    setSelected([]);
    setConfirming(false);
    setRemoving(false);

    const madeRoom = results.some(
      (result) => result.tap.deviceId === thisTapId && result.removed.length > 0
    );
    if (onMadeRoom && madeRoom) {
      await onMadeRoom();
    }
  };

  const summary = thisTap?.library
    ? makingRoom
      ? `This tap's library is full (${thisTap.library.beers.length} of ${thisTap.library.capacity}). Choose beers to remove from every tap to make room for the one just sent, or close to leave it unsaved.`
      : `${thisTap.library.beers.length} of ${thisTap.library.capacity} on this tap`
    : thisTap?.failed
      ? "This tap's library couldn't be read"
      : null;
  const separator = makingRoom ? ' ' : ' · ';

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !removing) {
          onClose();
        }
      }}
    >
      <div
        className="app-modal library-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-modal-title"
        aria-busy={loading || removing}
      >
        <div className="library-heading">
          <div className="modal-icon settings-modal-icon" aria-hidden="true">
            <Library size={22} strokeWidth={1.8} />
          </div>
          <div>
            <h2 id="library-modal-title">{makingRoom ? 'Make room' : 'Beer library'}</h2>
            <p className="library-summary" aria-live="polite">
              {summary}
              {asking.length > 0 && (
                <>
                  {summary && separator}
                  <span className="library-asking">
                    <LoaderCircle className="upload-spinner" size={13} aria-hidden="true" />
                    Asking {namesText(asking)}…
                  </span>
                </>
              )}
              {unreachable.length > 0 &&
                `${separator}${namesText(unreachable)} couldn't be reached${makingRoom ? '.' : ''}`}
            </p>
          </div>
        </div>

        {(!makingRoom || shownBeers.length > 0) && (
          <ul
            className={`library-grid ${selecting ? 'is-selecting' : ''}`}
            aria-label={
              selecting ? 'Beers to remove' : 'The keg states, then beers, last shown first'
            }
          >
            {!makingRoom &&
              KEG_STATES.map((state) => {
                const keg = kegPictures[state];

                return (
                  <li key={state} className="library-keg">
                    <button
                      className="library-beer"
                      type="button"
                      disabled={busy || selecting || !keg}
                      aria-label={`Load ${kegStateName[state]}${keg ? `, "${keg.line}"` : ''}`}
                      onClick={() => {
                        if (keg && onPickKegState) {
                          // So next time it gets another line
                          rememberLine(state, keg.line);
                          onPickKegState({
                            state,
                            line: keg.line,
                            date: keg.date,
                            picture: keg.picture,
                          });
                        }
                      }}
                    >
                      <span className="library-thumbnail">
                        {keg && <img src={keg.url} alt="" />}
                      </span>
                      <span className="library-beer-label">{kegStateName[state]}</span>
                    </button>
                  </li>
                );
              })}
            {shownBeers.map((beer) => {
              const lastShown = formatLastShown(beer);
              const chosen = selected.includes(beer.id);

              return (
                <li key={beer.id} className={chosen ? 'is-selected' : undefined}>
                  <button
                    className="library-beer"
                    type="button"
                    disabled={busy}
                    aria-pressed={selecting ? chosen : undefined}
                    aria-label={
                      selecting
                        ? `Select the beer last shown on ${lastShown}`
                        : `Load the beer last shown on ${lastShown}`
                    }
                    onClick={() => (selecting ? toggle(beer.id) : void pick(beer))}
                  >
                    <span className="library-thumbnail">
                      {thumbnails[beer.id] && <img src={thumbnails[beer.id]} alt="" />}
                      {picking === beer.id && (
                        <LoaderCircle className="upload-spinner" size={26} aria-hidden="true" />
                      )}
                    </span>
                    <span className="library-beer-label">{lastShown}</span>
                  </button>
                  {/* Beside the beer rather than in it, as a button can't hold one */}
                  <button
                    className="library-check"
                    type="button"
                    disabled={busy}
                    aria-pressed={chosen}
                    aria-label={`Select the beer last shown on ${lastShown}`}
                    onClick={() => toggle(beer.id)}
                  >
                    <span className="library-check-mark" aria-hidden="true">
                      {chosen && <Check size={16} strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {shownBeers.length === 0 && (
          <p className="library-empty">
            {loading
              ? 'Loading the beers…'
              : 'No beers yet. Each picture sent from Image mode is saved here, to send again later.'}
          </p>
        )}

        {notice && (
          <p
            className={notice.error ? 'laser-modal-error' : 'library-notice'}
            role={notice.error ? 'alert' : 'status'}
          >
            {notice.error && <CircleAlert size={16} aria-hidden="true" />} {notice.text}
          </p>
        )}

        {confirming ? (
          <div className="modal-actions library-actions">
            <p className="library-confirm">
              Remove {beersText(selected.length)} from every tap?{' '}
              {selected.length === 1 ? "Its picture can't" : "Their pictures can't"} be got back.
            </p>
            <button
              className="modal-button"
              type="button"
              disabled={removing}
              onClick={() => setConfirming(false)}
            >
              Back
            </button>
            <button
              className="modal-button destructive-button"
              type="button"
              autoFocus
              disabled={removing}
              onClick={() => void remove()}
            >
              {removing && <LoaderCircle className="upload-spinner" size={16} aria-hidden="true" />}
              {removing ? 'Removing…' : makingRoom ? 'Remove and save' : 'Remove'}
            </button>
          </div>
        ) : selecting ? (
          <div className="modal-actions library-actions">
            <p className="library-confirm">
              {selected.length > 0 ? `${selected.length} selected` : 'Choose the beers to remove'}
            </p>
            <button
              className="modal-button"
              type="button"
              disabled={busy}
              onClick={makingRoom ? onClose : clearSelection}
            >
              {makingRoom ? "Don't save" : 'Cancel'}
            </button>
            <button
              className="modal-button destructive-button"
              type="button"
              disabled={busy || selected.length === 0}
              onClick={() => setConfirming(true)}
            >
              {/* With nothing chosen yet, no count. */}
              {[
                'Remove',
                selected.length > 0 ? ` ${selected.length}` : '',
                makingRoom ? ' and save' : '',
              ].join('')}
            </button>
          </div>
        ) : (
          <div className="modal-actions library-actions">
            {beers.length > 0 && <p className="library-hint">Tick beers to remove them</p>}
            <button className="modal-button" type="button" autoFocus onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
