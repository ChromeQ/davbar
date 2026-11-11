// The Library: every tap's beers in one grid, each once, last shown first.
// Picking one loads its picture into Compose, like choosing a file.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Library, LoaderCircle } from 'lucide-react';

import { deviceConfig, type TapLink } from './device-config';
import {
  fetchBeerFile,
  fetchTapLibrary,
  formatLastShown,
  mergeLibraries,
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
export const thisTapLibrary = tapAddress(
  libraryTaps.find((tap) => tap.deviceId === thisTapId) ?? libraryTaps[0]!,
  thisTapId,
  'library'
);

export const LibraryDialog = ({ onClose, onPick }: LibraryDialogProps) => {
  const [taps, setTaps] = useState<TapState[]>(() =>
    libraryTaps.map((tap) => ({ tap, library: null, failed: false }))
  );
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState('');
  const mounted = useRef(true);
  // Thumbnails asked for, and the addresses made for them, freed on closing.
  const requested = useRef(new Set<string>());
  const thumbnailUrls = useRef<string[]>([]);

  // A new list only when a tap's answer arrives, so the thumbnails effect runs then.
  const beers = useMemo(
    () => mergeLibraries(taps.flatMap((state) => (state.library ? [state.library] : []))),
    [taps]
  );
  const thisTap = taps.find((state) => state.tap.deviceId === thisTapId);
  const unreachable = taps.filter((state) => state.failed).map((state) => state.tap.deviceName);
  const loading = taps.some((state) => !state.library && !state.failed);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      thumbnailUrls.current.forEach((url) => URL.revokeObjectURL(url));
      thumbnailUrls.current = [];
    };
  }, []);

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
    setPickError('');

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
        setPickError(
          `That beer couldn't be loaded: ${error instanceof Error ? error.message : 'no answer.'}`
        );
      }
    } finally {
      if (mounted.current) {
        setPicking(null);
      }
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="app-modal library-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-modal-title"
        aria-busy={loading}
      >
        <div className="library-heading">
          <div className="modal-icon settings-modal-icon" aria-hidden="true">
            <Library size={22} strokeWidth={1.8} />
          </div>
          <div>
            <h2 id="library-modal-title">Beer library</h2>
            <p className="library-summary">
              {thisTap?.library
                ? `${thisTap.library.beers.length} of ${thisTap.library.capacity} on this tap`
                : thisTap?.failed
                  ? "This tap's library couldn't be read"
                  : 'Loading…'}
              {unreachable.length > 0 && ` · ${unreachable.join(' and ')} couldn't be reached`}
            </p>
          </div>
        </div>

        {beers.length > 0 ? (
          <ul className="library-grid" aria-label="Beers, last shown first">
            {beers.map((beer) => {
              const lastShown = formatLastShown(beer);

              return (
                <li key={beer.id}>
                  <button
                    className="library-beer"
                    type="button"
                    disabled={picking !== null}
                    aria-label={`Load the beer last shown on ${lastShown}`}
                    onClick={() => void pick(beer)}
                  >
                    <span className="library-thumbnail">
                      {thumbnails[beer.id] && <img src={thumbnails[beer.id]} alt="" />}
                      {picking === beer.id && (
                        <LoaderCircle className="upload-spinner" size={26} aria-hidden="true" />
                      )}
                    </span>
                    <span className="library-beer-label">{lastShown}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="library-empty">
            {loading
              ? 'Loading the beers…'
              : 'No beers yet. Each picture sent from Image mode is saved here, to send again later.'}
          </p>
        )}

        {pickError && (
          <p className="laser-modal-error" role="alert">
            <CircleAlert size={16} aria-hidden="true" /> {pickError}
          </p>
        )}

        <div className="modal-actions">
          <button className="modal-button" type="button" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
