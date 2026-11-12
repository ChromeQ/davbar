import { afterEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_BYTES } from './screen';
import { fetchSetupHelp, setupHelpAddress } from './setup-help';

describe('the setup help preview', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks this page's tap for the screen chosen", async () => {
    vi.stubEnv('DEV', false);
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(IMAGE_BYTES).fill(0x11)));
    vi.stubGlobal('fetch', fetch);

    const bytes = await fetchSetupHelp('join');

    expect(fetch.mock.calls[0]![0]).toBe('/setup-help?screen=join');
    expect(bytes).toHaveLength(IMAGE_BYTES);
    expect(bytes[0]).toBe(0x11);
  });

  it('asks the tap by its address from the dev server', () => {
    vi.stubEnv('DEV', true);

    expect(setupHelpAddress('ready')).toMatch(/^http:\/\/.+\/setup-help\?screen=ready$/);
  });

  it("says when the tap's firmware is too old to draw it, or turns it down", async () => {
    vi.stubEnv('DEV', false);

    // Older firmware answers an unknown address with its page.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html>')));
    await expect(fetchSetupHelp('join')).rejects.toThrow(/firmware may be older/);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Busy', { status: 503 })));
    await expect(fetchSetupHelp('ready')).rejects.toThrow(/status 503/);
  });
});
