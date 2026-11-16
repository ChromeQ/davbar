// The tap's 400 x 600 screen: the uploaded image fills the top 400 x 400, and the
// tap draws the keg strip in the 200 rows below it.
import { decodeSpectra6 } from '@chromeq/davbar-spectra6';

import { HIDDEN_X, HIDDEN_Y, TEST_BORDER } from './strip';

export const SCREEN_WIDTH = 400;
export const SCREEN_HEIGHT = 600;
// The image is square: this is its width and its height.
export const IMAGE_SIZE = 400;
// The image as uploaded and stored on the tap: 2 pixels a byte.
export const IMAGE_BYTES = (IMAGE_SIZE * IMAGE_SIZE) / 2;

// On a tap with no laser on purpose there's no strip, so the picture is the whole
// screen: the square in the middle, with its background filling the 100 rows
// above and below (docs/display.md, No laser on purpose). The same rules as the tap's
// (esp32/lib/Strip/ScreenLayout).
export const WHOLE_SCREEN_BYTES = (SCREEN_WIDTH * SCREEN_HEIGHT) / 2;
export const BAND_HEIGHT = (SCREEN_HEIGHT - IMAGE_SIZE) / 2;
export const BAND_BYTES = (SCREEN_WIDTH / 2) * BAND_HEIGHT;

// A picture is the square or the whole screen.
export const isPictureSize = (bytes: number) =>
  bytes === IMAGE_BYTES || bytes === WHOLE_SCREEN_BYTES;

// An image's size in its own pixels. An ImageBitmap is one.
export type ImageSize = { width: number; height: number };

// The part of the square that shows in the case's window, in the square's
// pixels: all but what the frame hides at the sides, and at the top on a tap with
// a laser, where the square is the top of the screen. On a tap with no laser the
// square sits in the middle of the screen, clear of the frame above and below.
// Its bottom meets the strip, or the band below.
export type Visible = { left: number; top: number; right: number; bottom: number };

export const SQUARE: Visible = { left: 0, top: 0, right: IMAGE_SIZE, bottom: IMAGE_SIZE };

export const visibleSquare = (wholeScreen: boolean): Visible => ({
  left: HIDDEN_X,
  top: wholeScreen ? 0 : HIDDEN_Y,
  right: IMAGE_SIZE - HIDDEN_X,
  bottom: IMAGE_SIZE,
});

// How big the image is drawn. Fit, zoom 1, shows all of it in the square. Fill
// covers the square, cropping the rest. Zoom goes on past Fill to ZOOM_PAST_FILL
// times it, to show a detail, and down from Fit to make the image as wide or as
// tall as the part of the square the window shows (windowZoom): one shows all of
// it, with background beside it, and the other none of the background, with a
// little of the image under the frame.
export const FIT_ZOOM = 1;
const ZOOM_PAST_FILL = 3;

export const fillZoom = (image: ImageSize) =>
  Math.max(image.width, image.height) / Math.min(image.width, image.height);

export const maxZoom = (image: ImageSize) => fillZoom(image) * ZOOM_PAST_FILL;

export type WindowSide = 'width' | 'height';

export const windowZoom = (image: ImageSize, visible: Visible, side: WindowSide) =>
  (side === 'width'
    ? (visible.right - visible.left) / image.width
    : (visible.bottom - visible.top) / image.height) /
  Math.min(IMAGE_SIZE / image.width, IMAGE_SIZE / image.height);

// The least zoom, which shows all of the image in the window
export const visibleFitZoom = (image: ImageSize, visible: Visible) =>
  Math.min(windowZoom(image, visible, 'width'), windowZoom(image, visible, 'height'));

// The zoom slider moves on a log scale, so each step zooms by about 1%, and Fit
// and Fill are exactly on its steps. Its value is the zoom's natural log. It
// starts a whole number of steps below Fit, at or just below the visible fit,
// which counts as it.
const ZOOM_STEP = 0.01;

export const zoomSlider = (image: ImageSize, visible: Visible = SQUARE) => {
  const fill = Math.log(fillZoom(image));
  const step = fill > 0 ? fill / Math.max(1, Math.round(fill / ZOOM_STEP)) : ZOOM_STEP;
  const below = Math.ceil(-Math.log(visibleFitZoom(image, visible)) / step - 1e-9);

  return { min: -below * step, max: Math.log(maxZoom(image)), step, fill };
};

// Within 3% of the window's width or height, Fit or Fill, the slider snaps to the
// nearest, as landing on one exactly by dragging is hard.
const ZOOM_SNAP = Math.log(1.03);

export const zoomFromSlider = (image: ImageSize, value: number, visible: Visible = SQUARE) => {
  const zoom = Math.exp(value);
  const least = Math.min(FIT_ZOOM, visibleFitZoom(image, visible));
  const marks = [
    windowZoom(image, visible, 'width'),
    windowZoom(image, visible, 'height'),
    FIT_ZOOM,
    fillZoom(image),
  ]
    .map((mark) => ({ mark, distance: Math.abs(Math.log(zoom / mark)) }))
    .filter(({ distance }) => distance < ZOOM_SNAP)
    .sort((a, b) => a.distance - b.distance);

  if (marks[0]) {
    return marks[0].mark;
  }

  return Math.min(maxZoom(image), Math.max(least, zoom));
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

// Where the image goes in the square, in the square's pixels. A part drawn no
// bigger than the square is centred in the part the window shows, as near as it
// can be while staying in the square.
export const placeImage = (image: ImageSize, zoom: number, pan: Pan, visible: Visible = SQUARE) => {
  const scale = Math.min(IMAGE_SIZE / image.width, IMAGE_SIZE / image.height) * zoom;
  const width = image.width * scale;
  const height = image.height * scale;
  const place = (centre: number, size: number, from: number, to: number) =>
    size <= IMAGE_SIZE
      ? Math.min(IMAGE_SIZE - size, Math.max(0, (from + to - size) / 2))
      : IMAGE_SIZE / 2 - clampCentre(centre, size) * size;

  return {
    x: place(pan.x, width, visible.left, visible.right),
    y: place(pan.y, height, visible.top, visible.bottom),
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

// What fills the square behind the text, or the gaps around an image: a colour,
// a gradient from colour to endColour (top to bottom, or out from the middle), or,
// for an image, the same image blurred behind it.
export type BackgroundStyle = 'solid' | 'linear' | 'radial' | 'blur';

export type Background = { style: BackgroundStyle; colour: string; endColour: string };

// Which of the background's colours its style uses.
export type BackgroundColour = 'colour' | 'endColour';

export const backgroundColours = (style: BackgroundStyle): BackgroundColour[] => {
  if (style === 'blur') {
    return [];
  }

  return style === 'solid' ? ['colour'] : ['colour', 'endColour'];
};

export const isGradient = (style: BackgroundStyle) => style === 'linear' || style === 'radial';

// Fills the square with the background, or the whole screen when height is the
// screen's, with a gradient running over all of it. A blurred image is drawn
// over white by drawImageInSquare.
export const paintBackground = (
  context: CanvasRenderingContext2D,
  background: Background,
  height = IMAGE_SIZE
) => {
  const middleX = IMAGE_SIZE / 2;
  const middleY = height / 2;

  if (isGradient(background.style)) {
    const gradient =
      background.style === 'linear'
        ? context.createLinearGradient(0, 0, 0, height)
        : context.createRadialGradient(
            middleX,
            middleY,
            0,
            middleX,
            middleY,
            Math.hypot(middleX, middleY)
          );

    gradient.addColorStop(0, background.colour);
    gradient.addColorStop(1, background.endColour);
    context.fillStyle = gradient;
  } else {
    context.fillStyle = background.style === 'solid' ? background.colour : '#ffffff';
  }

  context.fillRect(0, 0, IMAGE_SIZE, height);
};

// How blurred the blurred background is, in the square's pixels.
const BLUR = 24;

// Draws the image in the square, with the background around it. With height the
// screen's, the square sits in the middle of the whole screen and the
// background fills the bands above and below; the image stays in the square.
export const drawImageInSquare = (
  context: CanvasRenderingContext2D,
  image: ImageSize & CanvasImageSource,
  zoom: number,
  pan: Pan,
  background: Background,
  height = IMAGE_SIZE
) => {
  const place = placeImage(image, zoom, pan, visibleSquare(height > IMAGE_SIZE));
  const top = (height - IMAGE_SIZE) / 2;

  context.imageSmoothingQuality = 'high';
  paintBackground(context, background, height);

  if (background.style === 'blur' && (hasGaps(image, zoom) || top > 0)) {
    // The image filling the square around the same point, or the whole screen
    // around its middle, blurred. Drawn bigger than that, so the blur's faded
    // edges fall outside it.
    const scale = Math.max(IMAGE_SIZE / image.width, height / image.height);
    const cover =
      top > 0
        ? {
            x: (IMAGE_SIZE - image.width * scale) / 2,
            y: (height - image.height * scale) / 2,
            width: image.width * scale,
            height: image.height * scale,
          }
        : placeImage(image, fillZoom(image), pan);

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

  context.save();
  context.beginPath();
  context.rect(0, top, IMAGE_SIZE, IMAGE_SIZE);
  context.clip();
  context.drawImage(image, place.x, top + place.y, place.width, place.height);
  context.restore();
};

// The screen's bytes, the same 120,000 the tap sends to the panel, for a picture
// of either size: the whole screen when strip is null, otherwise the square
// above the strip. As on the tap, a whole-screen picture above a strip shows its
// middle square, and a square picture on the whole screen sits on white bands.
export const screenBytes = (picture: Uint8Array, strip: Uint8Array | null) => {
  const bytes = new Uint8Array(WHOLE_SCREEN_BYTES).fill(0x11);
  const wholePicture = picture.length === WHOLE_SCREEN_BYTES;

  if (strip === null) {
    bytes.set(picture, wholePicture ? 0 : BAND_BYTES);
  } else {
    bytes.set(wholePicture ? picture.subarray(BAND_BYTES, BAND_BYTES + IMAGE_BYTES) : picture);
    bytes.set(strip, IMAGE_BYTES);
  }

  return bytes;
};

// The test values' red border round the whole screen, just inside what the case's
// frame hides, for the setup help shown by "Show on device", in place of the
// strip's own, as the tap draws it (esp32/lib/Strip/ScreenLayout). bytes are the
// screen's.
export const drawTestBorder = (bytes: Uint8Array) => {
  const red = 0x3;
  const left = HIDDEN_X;
  const right = SCREEN_WIDTH - HIDDEN_X;
  const top = HIDDEN_Y;
  const bottom = SCREEN_HEIGHT - HIDDEN_Y;

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const edge =
        x < left + TEST_BORDER ||
        x >= right - TEST_BORDER ||
        y < top + TEST_BORDER ||
        y >= bottom - TEST_BORDER;

      if (edge) {
        const index = y * (SCREEN_WIDTH / 2) + (x >> 1);
        bytes[index] =
          x % 2 === 0 ? (bytes[index]! & 0x0f) | (red << 4) : (bytes[index]! & 0xf0) | red;
      }
    }
  }
};

// The whole screen as it will look (see screenBytes), with the test border round
// the setup help when it's shown for a test.
export const screenPixels = (
  picture: Uint8Array,
  strip: Uint8Array | null,
  testBorder = false
): ImageData => {
  const bytes = screenBytes(picture, strip);

  if (testBorder) {
    drawTestBorder(bytes);
  }

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
