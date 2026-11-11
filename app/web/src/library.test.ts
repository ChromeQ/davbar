import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchTapLibrary,
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
