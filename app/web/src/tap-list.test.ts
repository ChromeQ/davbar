import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadDeviceConfig, repositoryDirectory } from '../../scripts/device-config.ts';

const tapsFor = (profile: string) =>
  loadDeviceConfig(path.join(repositoryDirectory, profile)).config.taps;

// Reads the real profiles in config/.
describe('the tap switcher list', () => {
  it("lists every DavBar tap in order, with each one's address", () => {
    expect(tapsFor('config/tap-2.json')).toEqual([
      { deviceName: 'Tap 1', deviceId: 'tap1', url: 'http://davbar-tap1.local/' },
      { deviceName: 'Tap 2', deviceId: 'tap2', url: 'http://davbar-tap2.local/' },
      { deviceName: 'Tap 3', deviceId: 'tap3', url: 'http://davbar-tap3.local/' },
    ]);
  });

  it("leaves out profiles of another brand, such as the example's", () => {
    expect(tapsFor('config/example.json').map((tap) => tap.deviceName)).toEqual(['Tap 1']);
  });
});
