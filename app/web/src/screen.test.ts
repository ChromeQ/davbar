import { describe, expect, it } from 'vitest';

import {
  CENTRED,
  fillZoom,
  FIT_ZOOM,
  hasGaps,
  maxZoom,
  overflows,
  panBy,
  placeImage,
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
