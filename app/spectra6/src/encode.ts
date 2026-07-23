import { nearestColour, clamp } from "./dither.js";

export type Spectra6Image = {
  // Raw framebuffer for the ESP32
  bytes: Uint8Array;
  width: number;
  height: number;
};

export function encodeSpectra6(
  pixels: Uint8Array,
  width: number,
  height: number,
): Spectra6Image {
  if ((width * height) % 2 !== 0) {
    throw new Error("Width*height must be even");
  }

  const working = new Float32Array(width * height * 3);
  const output = new Uint8Array((width * height) / 2);
  const addError = (
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    factor: number,
  ) => {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return;
    }

    const i = (y * width + x) * 3;

    working[i]! += r * factor;
    working[i + 1]! += g * factor;
    working[i + 2]! += b * factor;
  };

  for (let i = 0; i < width * height; i++) {
    const p1 = pixels[i * 4];
    const p2 = pixels[i * 4 + 1];
    const p3 = pixels[i * 4 + 2];

    if (p1 !== undefined && p2 !== undefined && p3 !== undefined) {
      working[i * 3] = p1;
      working[i * 3 + 1] = p2;
      working[i * 3 + 2] = p3;
    } else {
      throw new Error(`Invalid pixel data at index ${i}: ${p1}, ${p2}, ${p3}`);
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;

      const r = clamp(working[i]);
      const g = clamp(working[i + 1]);
      const b = clamp(working[i + 2]);

      const colour = nearestColour(r, g, b);
      const er = r - colour.r;
      const eg = g - colour.g;
      const eb = b - colour.b;

      addError(x + 1, y, er, eg, eb, 7 / 16);
      addError(x - 1, y + 1, er, eg, eb, 3 / 16);
      addError(x, y + 1, er, eg, eb, 5 / 16);
      addError(x + 1, y + 1, er, eg, eb, 1 / 16);

      const pixel = y * width + x;
      const byte = Math.floor(pixel / 2);

      if (pixel % 2 === 0) {
        output[byte] = colour.value << 4;
      } else {
        output[byte]! |= colour.value;
      }
    }
  }

  return {
    bytes: output,
    width,
    height,
  };
}
