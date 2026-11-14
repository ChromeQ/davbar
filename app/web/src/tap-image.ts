// The image the tap has stored, which it draws above the strip. The preview shows
// it until something new is composed.
import { decodeSpectra6 } from '@chromeq/davbar-spectra6';

import { isObject, readDeviceJson } from './device-json';
import { readPictureSource, type PictureSource } from './picture-source';
import { BAND_BYTES, IMAGE_BYTES, IMAGE_SIZE, isPictureSize, WHOLE_SCREEN_BYTES } from './screen';

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

  // The square, or on a tap with no laser on purpose, the whole screen
  if (!isPictureSize(bytes.length)) {
    throw new Error(`The device's image is ${bytes.length} bytes, not a picture's.`);
  }

  return bytes;
};

// About the tap's picture, from GET /status: when it was uploaded, or null if the
// tap's clock wasn't set then or it has none, and how the page drew it, if it did.
export type TapImageInfo = { uploadedAt: string | null; source: PictureSource | null };

export const fetchTapImageInfo = async (): Promise<TapImageInfo> => {
  const response = await fetch('/status', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`The device answered with status ${response.status}.`);
  }

  const result = await readDeviceJson(response);
  const image = isObject(result.image) ? result.image : {};

  return {
    uploadedAt: typeof image.updated === 'string' ? image.updated : null,
    source: readPictureSource(image.source),
  };
};

// The tap's picture as the square's pixels (RGBA), for Compose: a whole-screen
// picture's middle square, which is the beer, as the library keeps it.
export const tapSquarePixels = (bytes: Uint8Array): Uint8ClampedArray<ArrayBuffer> => {
  const square =
    bytes.length === WHOLE_SCREEN_BYTES
      ? bytes.subarray(BAND_BYTES, BAND_BYTES + IMAGE_BYTES)
      : bytes;
  const decoded = decodeSpectra6(square, IMAGE_SIZE, IMAGE_SIZE);
  const rgba = new Uint8ClampedArray(IMAGE_SIZE * IMAGE_SIZE * 4);

  for (let pixel = 0; pixel < IMAGE_SIZE * IMAGE_SIZE; pixel++) {
    rgba[pixel * 4] = decoded.pixels[pixel * 3] ?? 0;
    rgba[pixel * 4 + 1] = decoded.pixels[pixel * 3 + 1] ?? 0;
    rgba[pixel * 4 + 2] = decoded.pixels[pixel * 3 + 2] ?? 0;
    rgba[pixel * 4 + 3] = 255;
  }

  return rgba;
};

// tapSquarePixels as a PNG, to load like any picture.
export const tapPictureBlob = (bytes: Uint8Array): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const context = canvas.getContext('2d');

  if (!context) {
    return Promise.reject(new Error('Unable to read the picture on the tap.'));
  }

  context.putImageData(new ImageData(tapSquarePixels(bytes), IMAGE_SIZE, IMAGE_SIZE), 0, 0);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Unable to read the picture on the tap.')),
      'image/png'
    )
  );
};
