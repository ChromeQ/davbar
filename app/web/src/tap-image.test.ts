import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BAND_BYTES, IMAGE_BYTES, IMAGE_SIZE, WHOLE_SCREEN_BYTES } from './screen';
import { fetchTapImage, fetchTapImageInfo, tapSquarePixels } from './tap-image';

describe("the tap's image", () => {
  beforeEach(() => {
    // As on a tap, not in `pnpm dev`
    vi.stubEnv('DEV', false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('gives the stored bytes: the square, or the whole screen with no laser', async () => {
    for (const size of [IMAGE_BYTES, WHOLE_SCREEN_BYTES]) {
      const stored = new Uint8Array(size).fill(0x15);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stored)));

      expect(await fetchTapImage()).toEqual(stored);
    }
  });

  it('gives nothing when the tap has no image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('No image', { status: 404 })));

    expect(await fetchTapImage()).toBeNull();
  });

  it('turns down an image of the wrong size', async () => {
    const odd = new Uint8Array(100000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(odd)));

    await expect(fetchTapImage()).rejects.toThrow(/100000 bytes, not a picture's/);
  });

  it("says what the tap answered when it can't send it", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    await expect(fetchTapImage()).rejects.toThrow(/status 503/);
  });
});

describe("the tap's picture in Compose", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The pixel's colour, as red, green and blue
  const pixel = (rgba: Uint8ClampedArray, index: number) => [
    ...rgba.subarray(index * 4, index * 4 + 3),
  ];
  const white = [255, 255, 255];
  const red = [255, 0, 0];

  it('is the square, in its six colours', () => {
    // Red, then white, all the way down (2 pixels a byte)
    const rgba = tapSquarePixels(new Uint8Array(IMAGE_BYTES).fill(0x31));

    expect(rgba).toHaveLength(IMAGE_SIZE * IMAGE_SIZE * 4);
    expect([pixel(rgba, 0), pixel(rgba, 1), rgba[3]]).toEqual([red, white, 255]);
  });

  it("is a whole-screen picture's middle square, the beer, as the library keeps it", () => {
    // White bands round a red square
    const whole = new Uint8Array(WHOLE_SCREEN_BYTES).fill(0x11);
    whole.fill(0x33, BAND_BYTES, BAND_BYTES + IMAGE_BYTES);
    const rgba = tapSquarePixels(whole);

    expect([pixel(rgba, 0), pixel(rgba, IMAGE_SIZE * IMAGE_SIZE - 1)]).toEqual([red, red]);
  });

  it("knows when it was uploaded, if the tap's clock was set", async () => {
    const status = (image: unknown) =>
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ hostname: 'davbar-tap1', image })));

    vi.stubGlobal('fetch', status({ size: 80000, updated: '2026-11-12T13:37:59Z' }));
    expect((await fetchTapImageInfo()).uploadedAt).toBe('2026-11-12T13:37:59Z');

    vi.stubGlobal('fetch', status({ size: 80000, updated: null }));
    expect((await fetchTapImageInfo()).uploadedAt).toBeNull();
  });

  it('knows how the page drew it, if it did', async () => {
    const status = (image: unknown) =>
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ hostname: 'davbar-tap1', image })));
    const keg = {
      kind: 'keg',
      state: 'empty',
      line: 'Gone too soon',
      date: '2026-11-13T09:00:00.000Z',
    };

    vi.stubGlobal('fetch', status({ size: 120000, updated: null, source: JSON.stringify(keg) }));
    expect((await fetchTapImageInfo()).source).toEqual(keg);

    // From a beer, or older firmware
    vi.stubGlobal('fetch', status({ size: 80000, updated: null, source: null }));
    expect((await fetchTapImageInfo()).source).toBeNull();
    vi.stubGlobal('fetch', status({ size: 80000, updated: null }));
    expect((await fetchTapImageInfo()).source).toBeNull();
  });
});
