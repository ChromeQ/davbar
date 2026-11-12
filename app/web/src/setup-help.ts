// The setup help the tap draws in place of a picture while it has none (PLAN.md,
// step 7). Developer mode's preview shows it as the tap draws it, from GET
// /setup-help, rather than drawing it again here. The password is left out.
import { deviceConfig } from './device-config';
import { IMAGE_BYTES } from './screen';
import type { SetupHelpScreen } from './test-values';

export const SETUP_HELP_SCREENS: { screen: SetupHelpScreen; label: string }[] = [
  { screen: 'join', label: '1 · Join Wi-Fi' },
  { screen: 'ready', label: '2 · Ready' },
];

// This page's tap, or in `pnpm dev`, the profile's tap by its address, as there
// is no tap behind the dev server.
export const setupHelpAddress = (screen: SetupHelpScreen) =>
  `${import.meta.env.DEV ? deviceConfig.uploadUrl : ''}/setup-help?screen=${screen}`;

// The screen's bytes, the same size as a picture's.
export const fetchSetupHelp = async (screen: SetupHelpScreen): Promise<Uint8Array> => {
  const response = await fetch(setupHelpAddress(screen), {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`the device answered with status ${response.status}.`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  // Older firmware sends its page instead.
  if (bytes.length !== IMAGE_BYTES) {
    throw new Error("the device didn't send it. Its firmware may be older than this page.");
  }

  return bytes;
};
