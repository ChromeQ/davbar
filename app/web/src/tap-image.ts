// The image the tap has stored, which it draws above the strip. The preview shows
// it until something new is composed.
import { IMAGE_BYTES } from './screen';

// GET /image gives its bytes, or 404 when the tap has none. Null then, and in
// `pnpm dev`, where there is no device.
export const fetchTapImage = async (): Promise<Uint8Array | null> => {
  if (import.meta.env.DEV) {
    return null;
  }

  const response = await fetch('/image', { cache: 'no-store' });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`The device answered with status ${response.status}.`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.length !== IMAGE_BYTES) {
    throw new Error(`The device's image is ${bytes.length} bytes, not ${IMAGE_BYTES}.`);
  }

  return bytes;
};
