// The beer library: each tap keeps the beers it has shown (see
// esp32/src/LibraryManager.h), and the web app shows them from every tap in one
// grid, each beer once. A beer's ID is its JPEG's CRC-32, so a copy on another tap
// has the same ID.
import { isObject, readDeviceJson } from './device-json';
import type { TapLink } from './device-config';

// The tap's limits (esp32/lib/BeerLibrary/BeerLibrary.h)
export const MAX_PICTURE_BYTES = 70 * 1024;
export const MAX_THUMBNAIL_BYTES = 16 * 1024;
export const THUMBNAIL_SIZE = 200;

export type TapBeer = {
  id: string;
  // When it was last shown on that tap, or null if the tap's clock wasn't set.
  shownAt: string | null;
};

export type TapLibrary = {
  tap: TapLink;
  beers: TapBeer[];
  capacity: number;
};

// A beer in the grid: the taps that have it, and where and when it was last shown.
export type LibraryBeer = {
  id: string;
  lastShown: { tap: TapLink; at: string | null };
  taps: TapLink[];
};

const isTapBeer = (value: unknown): value is TapBeer =>
  isObject(value) &&
  typeof value.id === 'string' &&
  /^[0-9a-f]{8}$/.test(value.id) &&
  (typeof value.shownAt === 'string' || value.shownAt === null);

// Every beer once, last shown first. Beers shown before a tap's clock was set go
// last.
export const mergeLibraries = (libraries: TapLibrary[]): LibraryBeer[] => {
  const beers = new Map<string, LibraryBeer>();

  for (const library of libraries) {
    for (const beer of library.beers) {
      const known = beers.get(beer.id);

      if (!known) {
        beers.set(beer.id, {
          id: beer.id,
          lastShown: { tap: library.tap, at: beer.shownAt },
          taps: [library.tap],
        });
        continue;
      }

      known.taps.push(library.tap);

      if (
        beer.shownAt !== null &&
        (known.lastShown.at === null || beer.shownAt > known.lastShown.at)
      ) {
        known.lastShown = { tap: library.tap, at: beer.shownAt };
      }
    }
  }

  return [...beers.values()].sort((a, b) => {
    if (a.lastShown.at !== b.lastShown.at) {
      if (a.lastShown.at === null) return 1;
      if (b.lastShown.at === null) return -1;
      return a.lastShown.at > b.lastShown.at ? -1 : 1;
    }

    return a.id < b.id ? -1 : 1;
  });
};

// The tap to fetch a beer's files from: this one if it has it, as it answers
// fastest, otherwise the one that showed it last.
export const sourceTap = (beer: LibraryBeer, thisTapId: string) =>
  beer.taps.find((tap) => tap.deviceId === thisTapId) ?? beer.lastShown.tap;

// "Tap 2 · 10 Nov", or "Tap 2 · Mar 2025" for an earlier year, or just "Tap 2"
// when the date isn't known.
export const formatLastShown = (beer: LibraryBeer, now = new Date()) => {
  const { tap, at } = beer.lastShown;

  if (!at) {
    return tap.deviceName;
  }

  const date = new Date(at);
  const sameYear = date.getFullYear() === now.getFullYear();
  const text = date.toLocaleDateString(
    'en-AU',
    sameYear ? { day: 'numeric', month: 'short' } : { month: 'short', year: 'numeric' }
  );

  return `${tap.deviceName} · ${text}`;
};

// "Tap 2", "Tap 2 and Tap 3", or "Tap 1, Tap 2 and Tap 3".
export const namesText = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

// Where to ask a tap: this page's own tap by a relative address, so it works
// however the page was opened, and other taps by their .local address. In
// `pnpm dev` every tap is asked by its address, as there is no tap behind the
// dev server.
export const tapAddress = (tap: TapLink, thisTapId: string, path: string) =>
  tap.deviceId === thisTapId && !import.meta.env.DEV
    ? `/${path}`
    : `${tap.url.replace(/\/$/, '')}/${path}`;

// The beer on a tap's screen, from its library, or null. Sending a picture saves
// it to the library, or marks it shown, straight after the upload, so a beer
// last shown at or after the picture was uploaded is that picture, as it was
// before the six colours. A picture the library doesn't keep, such as text or a
// keg state, is uploaded after any beer was shown. uploadedAt is null if the
// tap's clock wasn't set.
export const beerOnScreen = (beers: TapBeer[], uploadedAt: string | null): string | null => {
  const uploaded = uploadedAt === null ? Number.NaN : Date.parse(uploadedAt);

  if (Number.isNaN(uploaded)) {
    return null;
  }

  let last: { id: string; at: number } | null = null;

  for (const beer of beers) {
    const at = beer.shownAt === null ? Number.NaN : Date.parse(beer.shownAt);

    if (!Number.isNaN(at) && (last === null || at > last.at)) {
      last = { id: beer.id, at };
    }
  }

  return last !== null && last.at >= uploaded ? last.id : null;
};

// A tap's beers. Taps that don't answer within a few seconds are left out.
export const fetchTapLibrary = async (tap: TapLink, thisTapId: string): Promise<TapLibrary> => {
  const response = await fetch(tapAddress(tap, thisTapId, 'library'), {
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });

  if (!response.ok) {
    throw new Error(`${tap.deviceName} answered with status ${response.status}.`);
  }

  const result = await readDeviceJson(response);

  if (
    !Array.isArray(result.beers) ||
    !result.beers.every(isTapBeer) ||
    typeof result.capacity !== 'number'
  ) {
    throw new Error(`${tap.deviceName} returned an invalid response.`);
  }

  return { tap, beers: result.beers, capacity: result.capacity };
};

// A beer's picture or thumbnail. Browsers keep these for good, as a beer's
// files never change.
export const fetchBeerFile = async (
  tap: TapLink,
  thisTapId: string,
  id: string,
  file: 'picture' | 'thumbnail'
): Promise<Blob> => {
  const name = file === 'picture' ? `${id}.jpg` : `${id}.thumb.jpg`;
  const response = await fetch(tapAddress(tap, thisTapId, `library/${name}`), {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`${tap.deviceName} answered with status ${response.status}.`);
  }

  return response.blob();
};

export type SaveResult =
  | { outcome: 'saved' | 'already-saved'; id: string }
  | { outcome: 'full' | 'failed'; message: string };

// Saves a beer to this page's tap, or marks it shown again if the tap has it.
// address is where to send it (see tapAddress).
export const saveBeer = async (
  address: string,
  picture: Blob,
  thumbnail: Blob
): Promise<SaveResult> => {
  const form = new FormData();
  form.append('image', picture, 'image.jpg');
  form.append('thumbnail', thumbnail, 'thumbnail.jpg');

  try {
    const response = await fetch(address, { method: 'POST', body: form });
    const result = await readDeviceJson(response);

    if (response.ok && result.success === true && typeof result.id === 'string') {
      return { outcome: result.saved === true ? 'saved' : 'already-saved', id: result.id };
    }

    const message =
      typeof result.message === 'string' ? result.message : `status ${response.status}`;

    return { outcome: result.full === true ? 'full' : 'failed', message };
  } catch (error) {
    // fetch() fails with a TypeError when the tap can't be reached.
    return {
      outcome: 'failed',
      message:
        error instanceof Error && !(error instanceof TypeError)
          ? error.message
          : "the tap didn't answer.",
    };
  }
};

// Beers a tap removes in one request (esp32/lib/BeerLibrary/BeerLibrary.h): the
// tap restarts if one request holds it for 5s.
export const MAX_REMOVED_AT_ONCE = 10;

// Which of the chosen beers each tap has, so each is asked to remove only its own.
export const removalPlan = (libraries: TapLibrary[], ids: string[]) =>
  libraries
    .map((library) => ({
      tap: library.tap,
      ids: library.beers.map((beer) => beer.id).filter((id) => ids.includes(id)),
    }))
    .filter((plan) => plan.ids.length > 0);

// The items in batches of at most size.
export const inBatches = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size)
  );

export type RemoveResult = {
  tap: TapLink;
  // The beers gone from the tap, whether removed now or already gone.
  removed: string[];
  // Why the rest weren't removed, or null if they all were.
  error: string | null;
};

// Why a request to a tap failed, to follow "Tap 2 couldn't remove them: ".
const failureOf = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return "it didn't answer in time.";
  }

  // fetch() fails with a TypeError when the tap can't be reached.
  return error instanceof Error && !(error instanceof TypeError)
    ? error.message
    : "it didn't answer.";
};

// Removes beers from one tap, a batch at a time, stopping at the first failure.
export const removeBeers = async (
  tap: TapLink,
  thisTapId: string,
  ids: string[]
): Promise<RemoveResult> => {
  const removed: string[] = [];

  for (const batch of inBatches(ids, MAX_REMOVED_AT_ONCE)) {
    try {
      const response = await fetch(tapAddress(tap, thisTapId, 'library/remove'), {
        method: 'POST',
        body: new URLSearchParams({ ids: batch.join(',') }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await readDeviceJson(response);

      if (!response.ok || result.success !== true) {
        const message =
          typeof result.message === 'string' ? result.message : `status ${response.status}`;
        return { tap, removed, error: message };
      }

      removed.push(...batch);
    } catch (error) {
      return { tap, removed, error: failureOf(error) };
    }
  }

  return { tap, removed, error: null };
};

const sentenceCase = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

// "Removed 3 beers.", then any tap that couldn't remove them, and any that
// couldn't be reached, whose copies stay.
export const removalSummary = (results: RemoveResult[], unreachable: string[]) => {
  const removed = new Set(results.flatMap((result) => result.removed)).size;
  const parts = [
    removed > 0
      ? `Removed ${removed} ${removed === 1 ? 'beer' : 'beers'}.`
      : 'Nothing was removed.',
  ];

  for (const result of results) {
    if (result.error) {
      const what = result.removed.length > 0 ? 'them all' : 'them';
      parts.push(`${result.tap.deviceName} couldn't remove ${what}: ${sentenceCase(result.error)}`);
    }
  }

  if (unreachable.length > 0) {
    parts.push(`${namesText(unreachable)} couldn't be reached, so any copies there stay.`);
  }

  return parts.join(' ');
};

// The canvas as a JPEG of at most maxBytes, lowering the quality until it fits.
const jpegOf = async (canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> => {
  for (const quality of [0.9, 0.85, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );

    if (blob && blob.size <= maxBytes) {
      return blob;
    }
  }

  throw new Error('The picture is too detailed to save to the library.');
};

// A small copy of a picture for the grid.
export const thumbnailOf = async (picture: CanvasImageSource): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to make the thumbnail.');
  }

  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);

  return jpegOf(canvas, MAX_THUMBNAIL_BYTES);
};

// The composed square, as it was before the six colours, as the library's
// picture and thumbnail.
export const beerPictures = async (
  pixels: Uint8ClampedArray,
  size: number
): Promise<{ picture: Blob; thumbnail: Blob }> => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to make the picture.');
  }

  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);

  return {
    picture: await jpegOf(canvas, MAX_PICTURE_BYTES),
    thumbnail: await thumbnailOf(canvas),
  };
};
