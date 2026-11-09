// The tap's 400 x 600 screen: the uploaded image fills the top 400 x 400, and the
// tap draws the keg strip in the 200 rows below it.
import { decodeSpectra6 } from '@chromeq/davbar-spectra6';

export const SCREEN_WIDTH = 400;
export const SCREEN_HEIGHT = 600;
// The image is square: this is its width and its height.
export const IMAGE_SIZE = 400;

// An image's size in its own pixels. An ImageBitmap is one.
export type ImageSize = { width: number; height: number };

// How big the image is drawn. Fit, zoom 1, shows all of it in the square. Fill
// covers the square, cropping the rest. Zoom goes on past Fill to ZOOM_PAST_FILL
// times it, to show a detail.
export const FIT_ZOOM = 1;
const ZOOM_PAST_FILL = 3;

export const fillZoom = (image: ImageSize) =>
  Math.max(image.width, image.height) / Math.min(image.width, image.height);

export const maxZoom = (image: ImageSize) => fillZoom(image) * ZOOM_PAST_FILL;

// The zoom slider moves on a log scale, so each step zooms by about 1%, and Fit
// and Fill are exactly on its steps. Its value is the zoom's natural log.
const ZOOM_STEP = 0.01;

export const zoomSlider = (image: ImageSize) => {
  const fill = Math.log(fillZoom(image));
  const step = fill > 0 ? fill / Math.max(1, Math.round(fill / ZOOM_STEP)) : ZOOM_STEP;

  return { max: Math.log(maxZoom(image)), step, fill };
};

// Within 3% of Fit or Fill, the slider snaps to it, as landing on it exactly by
// dragging is hard.
const ZOOM_SNAP = Math.log(1.03);

export const zoomFromSlider = (image: ImageSize, value: number) => {
  const zoom = Math.exp(value);

  for (const mark of [FIT_ZOOM, fillZoom(image)]) {
    if (Math.abs(Math.log(zoom / mark)) < ZOOM_SNAP) {
      return mark;
    }
  }

  return Math.min(maxZoom(image), Math.max(FIT_ZOOM, zoom));
};

// The point of the image at the square's centre, across and down: 0 is its left
// or top edge, 1 its right or bottom edge. Zooming keeps it in place.
export type Pan = { x: number; y: number };

export const CENTRED: Pan = { x: 0.5, y: 0.5 };

// A part of the image drawn smaller than the square is centred in it; a part
// drawn bigger always covers it.
const clampCentre = (centre: number, size: number) => {
  if (size <= IMAGE_SIZE) {
    return 0.5;
  }

  const half = IMAGE_SIZE / 2 / size;
  return Math.min(1 - half, Math.max(half, centre));
};

// Where the image goes in the square, in the square's pixels.
export const placeImage = (image: ImageSize, zoom: number, pan: Pan) => {
  const scale = Math.min(IMAGE_SIZE / image.width, IMAGE_SIZE / image.height) * zoom;
  const width = image.width * scale;
  const height = image.height * scale;

  return {
    x: IMAGE_SIZE / 2 - clampCentre(pan.x, width) * width,
    y: IMAGE_SIZE / 2 - clampCentre(pan.y, height) * height,
    width,
    height,
  };
};

// Within half a pixel counts as the square's size, so Fill leaves no gap.
const EDGE = 0.5;

// Whether the image leaves gaps for the background to fill.
export const hasGaps = (image: ImageSize, zoom: number) => {
  const { width, height } = placeImage(image, zoom, CENTRED);
  return width < IMAGE_SIZE - EDGE || height < IMAGE_SIZE - EDGE;
};

// Whether the image is bigger than the square, so dragging can move it.
export const overflows = (image: ImageSize, zoom: number) => {
  const { width, height } = placeImage(image, zoom, CENTRED);
  return width > IMAGE_SIZE + EDGE || height > IMAGE_SIZE + EDGE;
};

// The pan after dragging the image by dx and dy, in the square's pixels. Only a
// direction the image is bigger than the square in can move.
export const panBy = (image: ImageSize, zoom: number, pan: Pan, dx: number, dy: number): Pan => {
  const { width, height } = placeImage(image, zoom, pan);
  const move = (centre: number, size: number, by: number) =>
    size > IMAGE_SIZE + EDGE ? clampCentre(clampCentre(centre, size) - by / size, size) : centre;

  return { x: move(pan.x, width, dx), y: move(pan.y, height, dy) };
};

// What fills the gaps around the image: a colour (white to start with), or the
// same image blurred behind it.
export type FitBackground = 'colour' | 'blur';

// How blurred the blurred background is, in the square's pixels.
const BLUR = 24;

export const drawImageInSquare = (
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  zoom: number,
  pan: Pan,
  background: FitBackground,
  colour: string
) => {
  const place = placeImage(image, zoom, pan);

  context.imageSmoothingQuality = 'high';
  context.fillStyle = background === 'colour' ? colour : '#ffffff';
  context.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);

  if (background === 'blur' && hasGaps(image, zoom)) {
    // The image filling the square around the same point, blurred. Drawn bigger
    // than that, so the blur's faded edges fall outside the square.
    const cover = placeImage(image, fillZoom(image), pan);

    context.filter = `blur(${BLUR}px)`;
    context.drawImage(
      image,
      cover.x - BLUR * 2,
      cover.y - BLUR * 2,
      cover.width + BLUR * 4,
      cover.height + BLUR * 4
    );
    context.filter = 'none';
  }

  context.drawImage(image, place.x, place.y, place.width, place.height);
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
