import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_BYTES } from './screen';
import { fetchTapImage } from './tap-image';

describe("the tap's image", () => {
  beforeEach(() => {
    // As on a tap, not in `pnpm dev`
    vi.stubEnv('DEV', false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('gives the stored bytes', async () => {
    const stored = new Uint8Array(IMAGE_BYTES).fill(0x15);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stored)));

    expect(await fetchTapImage()).toEqual(stored);
  });

  it('gives nothing when the tap has no image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('No image', { status: 404 })));

    expect(await fetchTapImage()).toBeNull();
  });

  it('turns down an image of the wrong size', async () => {
    const old = new Uint8Array(120000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(old)));

    await expect(fetchTapImage()).rejects.toThrow(/120000 bytes, not 80000/);
  });

  it("says what the tap answered when it can't send it", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    await expect(fetchTapImage()).rejects.toThrow(/status 503/);
  });
});
