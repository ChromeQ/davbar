import { describe, expect, it } from 'vitest';

import {
  BAND_HEIGHT,
  CENTRED,
  drawImageInSquare,
  drawTestBorder,
  fillZoom,
  FIT_ZOOM,
  hasGaps,
  IMAGE_BYTES,
  IMAGE_SIZE,
  isPictureSize,
  maxZoom,
  overflows,
  paintBackground,
  panBy,
  placeImage,
  SCREEN_HEIGHT,
  screenBytes,
  WHOLE_SCREEN_BYTES,
  zoomFromSlider,
  zoomSlider,
} from './screen';

// A tall, skinny tap graphic, and a square one.
const tall = { width: 157, height: 443 };
const square = { width: 300, height: 300 };

describe('zooming', () => {
  it('fits all of the image in the square at Fit', () => {
    const place = placeImage(tall, FIT_ZOOM, CENTRED);

    expect(place.height).toBeCloseTo(400);
    expect(place.width).toBeCloseTo((400 * 157) / 443);
    expect(place.x).toBeCloseTo((400 - place.width) / 2);
    expect(place.y).toBeCloseTo(0);
    expect(hasGaps(tall, FIT_ZOOM)).toBe(true);
    expect(overflows(tall, FIT_ZOOM)).toBe(false);
  });

  it('covers the square at Fill', () => {
    const place = placeImage(tall, fillZoom(tall), CENTRED);

    expect(place.width).toBeCloseTo(400);
    expect(place.height).toBeCloseTo((400 * 443) / 157);
    expect(place.x).toBeCloseTo(0);
    expect(place.y).toBeCloseTo(200 - place.height / 2);
    expect(hasGaps(tall, fillZoom(tall))).toBe(false);
    expect(overflows(tall, fillZoom(tall))).toBe(true);
  });

  it('can be between Fit and Fill, with gaps one way and overflow the other', () => {
    const zoom = 1.7;
    const place = placeImage(tall, zoom, CENTRED);

    expect(place.width).toBeLessThan(400);
    expect(place.height).toBeGreaterThan(400);
    expect(hasGaps(tall, zoom)).toBe(true);
    expect(overflows(tall, zoom)).toBe(true);
  });

  it('has Fit and Fill the same for a square image', () => {
    expect(fillZoom(square)).toBe(FIT_ZOOM);
    expect(hasGaps(square, FIT_ZOOM)).toBe(false);
    expect(overflows(square, FIT_ZOOM)).toBe(false);
    expect(overflows(square, 2)).toBe(true);
  });
});

describe('panning', () => {
  it('keeps the chosen point of the image at the centre while zooming', () => {
    const pan = { x: 0.5, y: 0.4 };

    for (const zoom of [2, 3, 5]) {
      const place = placeImage(tall, zoom, pan);
      expect(place.y + 0.4 * place.height).toBeCloseTo(200);
    }
  });

  it('never leaves a gap where the image is bigger than the square', () => {
    const zoom = fillZoom(tall);
    const top = placeImage(tall, zoom, { x: 0.5, y: 0 });
    const bottom = placeImage(tall, zoom, { x: 0.5, y: 1 });

    expect(top.y).toBeCloseTo(0);
    expect(bottom.y + bottom.height).toBeCloseTo(400);
  });

  it('centres the image where it is smaller than the square', () => {
    const place = placeImage(tall, 1.7, { x: 0, y: 0.5 });
    expect(place.x).toBeCloseTo((400 - place.width) / 2);
  });

  it('moves with a drag only where the image is bigger than the square', () => {
    const zoom = fillZoom(tall);
    const height = placeImage(tall, zoom, CENTRED).height;
    const pan = panBy(tall, zoom, CENTRED, 50, 100);

    expect(pan.x).toBe(0.5);
    expect(pan.y).toBeCloseTo(0.5 - 100 / height);
    expect(panBy(tall, FIT_ZOOM, CENTRED, 50, 100)).toEqual(CENTRED);
  });

  it('stops a drag at the edge of the image', () => {
    const zoom = fillZoom(tall);
    const pan = panBy(tall, zoom, CENTRED, 0, 5000);

    expect(placeImage(tall, zoom, pan).y).toBeCloseTo(0);
  });
});

describe('the zoom slider', () => {
  it('has Fill exactly on one of its steps', () => {
    const slider = zoomSlider(tall);
    const steps = slider.fill / slider.step;

    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
    expect(slider.step).toBeCloseTo(0.01, 3);
    expect(Math.exp(slider.max)).toBeCloseTo(maxZoom(tall));
  });

  it('snaps to Fit and Fill when close to them', () => {
    expect(zoomFromSlider(tall, Math.log(1.02))).toBe(FIT_ZOOM);
    expect(zoomFromSlider(tall, Math.log(fillZoom(tall) * 0.98))).toBe(fillZoom(tall));
    expect(zoomFromSlider(tall, Math.log(fillZoom(tall) * 1.02))).toBe(fillZoom(tall));
    expect(zoomFromSlider(tall, Math.log(1.7))).toBeCloseTo(1.7);
  });

  it('keeps the zoom between Fit and its most', () => {
    expect(zoomFromSlider(tall, -1)).toBe(FIT_ZOOM);
    expect(zoomFromSlider(tall, 10)).toBe(maxZoom(tall));
  });
});

describe('a tap with no laser on purpose', () => {
  it('takes a picture of the square or the whole screen', () => {
    expect(isPictureSize(IMAGE_BYTES)).toBe(true);
    expect(isPictureSize(WHOLE_SCREEN_BYTES)).toBe(true);
    expect(isPictureSize(100_000)).toBe(false);
  });

  // A picture whose rows each start with their own number, in two bytes, so
  // where each row lands can be read back, as in the tap's tests.
  const picture = (rows: number) => {
    const bytes = new Uint8Array(rows * 200).fill(0x55);
    for (let y = 0; y < rows; y++) {
      bytes[y * 200] = y & 0xff;
      bytes[y * 200 + 1] = y >> 8;
    }
    return bytes;
  };
  const row = (bytes: Uint8Array, y: number) => bytes[y * 200]! | (bytes[y * 200 + 1]! << 8);
  const white = 0x1111;
  const strip = new Uint8Array(200 * 200).fill(0x66);

  it('places either size of picture as the tap does', () => {
    // The whole screen: a whole-screen picture fills it...
    let screen = screenBytes(picture(600), null);
    expect([row(screen, 0), row(screen, 300), row(screen, 599)]).toEqual([0, 300, 599]);
    // ...and a square one sits in the middle on white.
    screen = screenBytes(picture(400), null);
    expect([row(screen, 99), row(screen, 100), row(screen, 499), row(screen, 500)]).toEqual([
      white,
      0,
      399,
      white,
    ]);
    // Above the strip: a whole-screen picture shows its middle square...
    screen = screenBytes(picture(600), strip);
    expect([row(screen, 0), row(screen, 399), screen[400 * 200]]).toEqual([100, 499, 0x66]);
    // ...and a square one is just itself.
    screen = screenBytes(picture(400), strip);
    expect([row(screen, 0), row(screen, 399), screen[599 * 200]]).toEqual([0, 399, 0x66]);
    expect(screen).toHaveLength(WHOLE_SCREEN_BYTES);
  });

  // Records what's drawn, for the parts the drawing functions decide.
  const recorder = () => {
    const calls: string[] = [];
    const context = {
      set fillStyle(_value: unknown) {},
      set filter(_value: string) {},
      set imageSmoothingQuality(_value: string) {},
      createLinearGradient: (...args: number[]) => {
        calls.push(`linear ${args.join(' ')}`);
        return { addColorStop: () => {} };
      },
      createRadialGradient: (...args: number[]) => {
        calls.push(`radial ${args.map((n) => Math.round(n)).join(' ')}`);
        return { addColorStop: () => {} };
      },
      fillRect: (...args: number[]) => calls.push(`fill ${args.join(' ')}`),
      rect: (...args: number[]) => calls.push(`clip to ${args.join(' ')}`),
      drawImage: (_image: unknown, ...args: number[]) =>
        calls.push(`image ${args.map((n) => Math.round(n)).join(' ')}`),
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      clip: () => {},
    };
    return { calls, context: context as unknown as CanvasRenderingContext2D };
  };

  it('runs a gradient over the whole screen, and fills all of it', () => {
    const { calls, context } = recorder();
    paintBackground(context, { style: 'linear', colour: '#000', endColour: '#fff' }, SCREEN_HEIGHT);
    paintBackground(context, { style: 'radial', colour: '#000', endColour: '#fff' }, SCREEN_HEIGHT);

    expect(calls).toEqual([
      'linear 0 0 0 600',
      'fill 0 0 400 600',
      `radial 200 300 0 200 300 ${Math.round(Math.hypot(200, 300))}`,
      'fill 0 0 400 600',
    ]);
  });

  it('keeps the image in the square, in the middle of the whole screen', () => {
    const { calls, context } = recorder();
    // A wide image at Fit: 400 x 200, centred in the square
    const wide = { width: 800, height: 400 } as unknown as ImageBitmap;
    drawImageInSquare(
      context,
      wide,
      FIT_ZOOM,
      CENTRED,
      {
        style: 'solid',
        colour: '#123456',
        endColour: '#000000',
      },
      SCREEN_HEIGHT
    );

    expect(calls).toEqual([
      'fill 0 0 400 600',
      `clip to 0 ${BAND_HEIGHT} ${IMAGE_SIZE} ${IMAGE_SIZE}`,
      `image 0 ${BAND_HEIGHT + 100} 400 200`,
    ]);
  });

  it('blurs the image over the whole screen behind it', () => {
    const { calls, context } = recorder();
    const squareImage = { width: 400, height: 400 } as unknown as ImageBitmap;
    drawImageInSquare(
      context,
      squareImage,
      FIT_ZOOM,
      CENTRED,
      {
        style: 'blur',
        colour: '#000000',
        endColour: '#000000',
      },
      SCREEN_HEIGHT
    );

    // Covering 400 x 600 (600 x 600 for a square image), plus the blur's margin
    expect(calls[1]).toBe('image -148 -48 696 696');
    expect(calls.at(-1)).toBe(`image 0 ${BAND_HEIGHT} 400 400`);
  });

  it('puts one test border round the whole screen for the setup help, as the tap does', () => {
    const pixel = (bytes: Uint8Array, x: number, y: number) => {
      const byte = bytes[y * 200 + (x >> 1)]!;
      return x % 2 === 0 ? byte >> 4 : byte & 0x0f;
    };
    const red = 0x3;
    const white = 0x1;

    // Every edge, 5 pixels in, and no line between the square and the strip
    const bytes = new Uint8Array(WHOLE_SCREEN_BYTES).fill(0x11);
    drawTestBorder(bytes);
    expect([pixel(bytes, 0, 0), pixel(bytes, 399, 599), pixel(bytes, 4, 300)]).toEqual([
      red,
      red,
      red,
    ]);
    expect([
      pixel(bytes, 5, 300),
      pixel(bytes, 200, 594),
      pixel(bytes, 200, 399),
      pixel(bytes, 200, 400),
    ]).toEqual([white, white, white, white]);
  });
});
