import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beerOnScreen,
  fetchTapLibrary,
  inBatches,
  namesText,
  removalPlan,
  removalSummary,
  removeBeers,
  formatLastShown,
  mergeLibraries,
  saveBeer,
  sourceTap,
  tapAddress,
  type TapLibrary,
} from './library';

const tap = (number: number) => ({
  deviceName: `Tap ${number}`,
  deviceId: `tap${number}`,
  url: `http://davbar-tap${number}.local/`,
});

const library = (number: number, beers: TapLibrary['beers']): TapLibrary => ({
  tap: tap(number),
  beers,
  capacity: 30,
});

describe('the grid of every tap', () => {
  const merged = mergeLibraries([
    library(1, [
      { id: 'aaaaaaaa', shownAt: '2026-11-01T10:00:00Z' },
      { id: 'bbbbbbbb', shownAt: null },
    ]),
    library(2, [
      { id: 'aaaaaaaa', shownAt: '2026-11-09T12:00:00Z' },
      { id: 'cccccccc', shownAt: '2026-03-02T20:00:00Z' },
      { id: 'bbbbbbbb', shownAt: null },
    ]),
    library(3, []),
  ]);

  it('shows each beer once, last shown first, with unknown dates last', () => {
    expect(merged.map((beer) => beer.id)).toEqual(['aaaaaaaa', 'cccccccc', 'bbbbbbbb']);
  });

  it('says which tap showed each beer last', () => {
    expect(merged[0]!.lastShown).toEqual({ tap: tap(2), at: '2026-11-09T12:00:00Z' });
    expect(merged[0]!.taps.map((each) => each.deviceName)).toEqual(['Tap 1', 'Tap 2']);
    expect(merged[2]!.lastShown).toEqual({ tap: tap(1), at: null });
  });

  it("fetches files from this tap when it has the beer, otherwise the last tap's", () => {
    expect(sourceTap(merged[0]!, 'tap1')).toEqual(tap(1));
    expect(sourceTap(merged[1]!, 'tap1')).toEqual(tap(2));
  });

  it('words the last showing for the grid', () => {
    const now = new Date('2026-11-11T09:00:00Z');

    expect(formatLastShown(merged[0]!, now)).toBe('Tap 2 · 9 Nov');
    expect(formatLastShown(merged[2]!, now)).toBe('Tap 1');

    const lastYear = mergeLibraries([
      library(3, [{ id: 'dddddddd', shownAt: '2025-03-02T09:00:00Z' }]),
    ]);
    expect(formatLastShown(lastYear[0]!, now)).toBe('Tap 3 · Mar 2025');
  });

  it('names the taps still being asked, or not reached, as a list', () => {
    expect(namesText(['Tap 2'])).toBe('Tap 2');
    expect(namesText(['Tap 2', 'Tap 3'])).toBe('Tap 2 and Tap 3');
    expect(namesText(['Tap 1', 'Tap 2', 'Tap 3'])).toBe('Tap 1, Tap 2 and Tap 3');
  });
});

describe('asking the taps', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks this page's tap by a relative address, and others by name", () => {
    vi.stubEnv('DEV', false);

    expect(tapAddress(tap(1), 'tap1', 'library')).toBe('/library');
    expect(tapAddress(tap(2), 'tap1', 'library/aaaaaaaa.jpg')).toBe(
      'http://davbar-tap2.local/library/aaaaaaaa.jpg'
    );
  });

  it('asks every tap by name from the dev server', () => {
    vi.stubEnv('DEV', true);

    expect(tapAddress(tap(1), 'tap1', 'library')).toBe('http://davbar-tap1.local/library');
  });

  it("reads a tap's list and turns down anything else", async () => {
    vi.stubEnv('DEV', false);
    const answer = (body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));

    vi.stubGlobal('fetch', answer({ capacity: 30, beers: [{ id: 'aaaaaaaa', shownAt: null }] }));
    expect(await fetchTapLibrary(tap(2), 'tap1')).toEqual(
      library(2, [{ id: 'aaaaaaaa', shownAt: null }])
    );

    vi.stubGlobal('fetch', answer({ capacity: 30, beers: [{ id: '../image', shownAt: null }] }));
    await expect(fetchTapLibrary(tap(2), 'tap1')).rejects.toThrow(/invalid response/);
  });

  it('says whether the beer was saved, was there already, or the library is full', async () => {
    vi.stubEnv('DEV', false);
    const picture = new Blob(['jpeg'], { type: 'image/jpeg' });
    const answer = (status: number, body: unknown) =>
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
      );

    answer(200, { success: true, saved: true, id: 'aaaaaaaa' });
    expect(await saveBeer('/library', picture, picture)).toEqual({
      outcome: 'saved',
      id: 'aaaaaaaa',
    });

    answer(200, { success: true, saved: false, id: 'aaaaaaaa' });
    expect(await saveBeer('/library', picture, picture)).toEqual({
      outcome: 'already-saved',
      id: 'aaaaaaaa',
    });

    answer(409, { success: false, full: true, message: 'Full.' });
    expect(await saveBeer('/library', picture, picture)).toEqual({
      outcome: 'full',
      message: 'Full.',
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await saveBeer('/library', picture, picture)).toEqual({
      outcome: 'failed',
      message: "the tap didn't answer.",
    });
  });
});

describe('removing beers from every tap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('asks each tap to remove only the chosen beers it has', () => {
    const plan = removalPlan(
      [
        library(1, [
          { id: 'aaaaaaaa', shownAt: null },
          { id: 'bbbbbbbb', shownAt: null },
        ]),
        library(2, [{ id: 'aaaaaaaa', shownAt: null }]),
        library(3, [{ id: 'cccccccc', shownAt: null }]),
      ],
      ['aaaaaaaa', 'bbbbbbbb']
    );

    expect(plan).toEqual([
      { tap: tap(1), ids: ['aaaaaaaa', 'bbbbbbbb'] },
      { tap: tap(2), ids: ['aaaaaaaa'] },
    ]);
  });

  it('sends at most 10 at a time', () => {
    const ids = Array.from({ length: 23 }, (_, index) => String(index));

    expect(inBatches(ids, 10).map((batch) => batch.length)).toEqual([10, 10, 3]);
    expect(inBatches([], 10)).toEqual([]);
  });

  it('removes in batches, and stops at a batch the tap turns down', async () => {
    vi.stubEnv('DEV', false);
    const ids = Array.from({ length: 12 }, (_, index) => `0000000${index.toString(16)}`.slice(-8));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, removed: 10 })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: false, message: "Some beers couldn't be removed. Try again." }),
          {
            status: 500,
          }
        )
      );
    vi.stubGlobal('fetch', fetch);

    const result = await removeBeers(tap(2), 'tap1', ids);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![0]).toBe('http://davbar-tap2.local/library/remove');
    expect(String(fetch.mock.calls[1]![1].body)).toBe(`ids=${ids.slice(10).join('%2C')}`);
    expect(result.removed).toEqual(ids.slice(0, 10));
    expect(result.error).toBe("Some beers couldn't be removed. Try again.");
  });

  it('says what was removed, and where it may not have been', () => {
    const ok = { tap: tap(1), removed: ['aaaaaaaa', 'bbbbbbbb'], error: null };

    expect(removalSummary([ok, { tap: tap(2), removed: ['aaaaaaaa'], error: null }], [])).toBe(
      'Removed 2 beers.'
    );
    expect(
      removalSummary([ok, { tap: tap(2), removed: [], error: "it didn't answer." }], ['Tap 3'])
    ).toBe(
      "Removed 2 beers. Tap 2 couldn't remove them: it didn't answer. Tap 3 couldn't be reached, so any copies there stay."
    );
    expect(removalSummary([{ tap: tap(1), removed: [], error: 'Full.' }], [])).toBe(
      "Nothing was removed. Tap 1 couldn't remove them: full."
    );
  });
});

describe('the beer on the screen', () => {
  const uploadedAt = '2026-11-12T13:37:59Z';

  it('is the beer last shown since the picture was uploaded', () => {
    const beers = [
      { id: 'aaaaaaaa', shownAt: '2026-11-10T09:00:00Z' },
      // Saved straight after the upload, maybe in the same second
      { id: 'bbbbbbbb', shownAt: '2026-11-12T13:37:59Z' },
      { id: 'cccccccc', shownAt: null },
    ];

    expect(beerOnScreen(beers, uploadedAt)).toBe('bbbbbbbb');
    expect(beerOnScreen([{ id: 'bbbbbbbb', shownAt: '2026-11-12T13:38:02Z' }], uploadedAt)).toBe(
      'bbbbbbbb'
    );
  });

  it("is none when the last beer was shown before it, as text and keg states aren't kept", () => {
    const beers = [{ id: 'aaaaaaaa', shownAt: '2026-11-12T13:30:00Z' }];

    expect(beerOnScreen(beers, uploadedAt)).toBeNull();
  });

  it("is none when the tap's clock wasn't set, or there are no beers", () => {
    expect(beerOnScreen([{ id: 'aaaaaaaa', shownAt: '2026-11-12T14:00:00Z' }], null)).toBeNull();
    expect(beerOnScreen([{ id: 'aaaaaaaa', shownAt: null }], uploadedAt)).toBeNull();
    expect(beerOnScreen([], uploadedAt)).toBeNull();
  });
});
