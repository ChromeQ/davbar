// The tap's 400 x 600 screen: the uploaded image fills the top 400 x 400, and the
// tap draws the keg strip in the 200 rows below it.
import { decodeSpectra6 } from '@chromeq/davbar-spectra6';

export const SCREEN_WIDTH = 400;
export const SCREEN_HEIGHT = 600;
// The image is square: this is its width and its height.
export const IMAGE_SIZE = 400;

// How an image of any shape goes into the square: Fit shows all of it, with white
// in the gaps; Fill covers the square and crops the rest.
export type ImageFit = 'fit' | 'fill';

// Which part of a filled image shows, across and down: 0 is its left or top edge,
// 1 its right or bottom edge, and 0.5 the middle.
export type Pan = { x: number; y: number };

export const CENTRED: Pan = { x: 0.5, y: 0.5 };

const scaleFor = (image: ImageBitmap, fit: ImageFit) =>
  fit === 'fit'
    ? Math.min(IMAGE_SIZE / image.width, IMAGE_SIZE / image.height)
    : Math.max(IMAGE_SIZE / image.width, IMAGE_SIZE / image.height);

export const drawImageInSquare = (
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  fit: ImageFit,
  pan: Pan
) => {
  const scale = scaleFor(image, fit);
  const width = image.width * scale;
  const height = image.height * scale;
  // Fit centres the image; Fill's overflow (negative) is shared out by the pan.
  const x = (IMAGE_SIZE - width) * (fit === 'fit' ? 0.5 : pan.x);
  const y = (IMAGE_SIZE - height) * (fit === 'fit' ? 0.5 : pan.y);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, x, y, width, height);
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

// The pan after dragging a filled image by dx and dy, in the square's pixels. Only
// the direction the image overflows in can move.
export const panBy = (image: ImageBitmap, pan: Pan, dx: number, dy: number): Pan => {
  const scale = scaleFor(image, 'fill');
  const overflowX = image.width * scale - IMAGE_SIZE;
  const overflowY = image.height * scale - IMAGE_SIZE;

  return {
    x: overflowX > 0.5 ? clamp(pan.x - dx / overflowX) : 0.5,
    y: overflowY > 0.5 ? clamp(pan.y - dy / overflowY) : 0.5,
  };
};

// The whole screen as it will look. The encoded image's bytes followed by the
// strip's are the same 120,000 bytes the tap sends to the panel.
export const screenPixels = (imageBytes: Uint8Array, stripBytes: Uint8Array): ImageData => {
  const bytes = new Uint8Array(imageBytes.length + stripBytes.length);
  bytes.set(imageBytes);
  bytes.set(stripBytes, imageBytes.length);

  const decoded = decodeSpectra6(bytes, SCREEN_WIDTH, SCREEN_HEIGHT);
  const rgba = new Uint8ClampedArray(SCREEN_WIDTH * SCREEN_HEIGHT * 4);

  for (let pixel = 0; pixel < SCREEN_WIDTH * SCREEN_HEIGHT; pixel++) {
    rgba[pixel * 4] = decoded.pixels[pixel * 3] ?? 0;
    rgba[pixel * 4 + 1] = decoded.pixels[pixel * 3 + 1] ?? 0;
    rgba[pixel * 4 + 2] = decoded.pixels[pixel * 3 + 2] ?? 0;
    rgba[pixel * 4 + 3] = 255;
  }

  return new ImageData(rgba, SCREEN_WIDTH, SCREEN_HEIGHT);
};
