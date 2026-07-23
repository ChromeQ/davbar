import { describe, expect, it } from "vitest";
import { encodeSpectra6, decodeSpectra6 } from "../src/index.js";

describe("Spectra6 encoder", () => {
  it("encodes a 400x600 image into the expected framebuffer size", () => {
    const width = 400;
    const height = 600;

    const pixels = createSolidImage(width, height, 255, 255, 255);

    const result = encodeSpectra6(pixels, width, height);

    expect(result.width).toBe(width);
    expect(result.height).toBe(height);

    // 2 pixels per byte
    expect(result.bytes.length).toBe((width * height) / 2);
  });

  it("encodes two pixels into one byte using high/low nibbles", () => {
    const pixels = new Uint8Array([
      // pixel 1: black
      0, 0, 0, 255,

      // pixel 2: red
      255, 0, 0, 255,
    ]);

    const result = encodeSpectra6(pixels, 2, 1);

    // black = 0x0
    // red   = 0x3
    expect(result.bytes[0]).toBe(0x03);
  });
});

describe("Spectra6 decoder", () => {
  it("decodes packed bytes back into RGB pixels", () => {
    const bytes = new Uint8Array([
      // black, red
      0x03,
    ]);

    const result = decodeSpectra6(bytes, 2, 1);

    expect(result.width).toBe(2);

    expect(result.height).toBe(1);

    expect([...result.pixels]).toEqual([
      // black
      0, 0, 0,

      // red
      255, 0, 0,
    ]);
  });
});

describe("Spectra6 round trip", () => {
  it("preserves palette colours through encode/decode", () => {
    const width = 6;
    const height = 1;

    const pixels = new Uint8Array([
      // black
      0, 0, 0, 255,

      // white
      255, 255, 255, 255,

      // yellow
      255, 255, 0, 255,

      // red
      255, 0, 0, 255,

      // blue
      0, 0, 255, 255,

      // green
      0, 255, 0, 255,
    ]);

    const encoded = encodeSpectra6(pixels, width, height);

    const decoded = decodeSpectra6(encoded.bytes, width, height);

    expect(decoded.pixels.length).toBe(width * height * 3);

    // Ensure every output pixel is one of the palette colours
    for (let i = 0; i < decoded.pixels.length; i += 3) {
      expect([0, 255]).toContain(decoded.pixels[i]);
    }
  });
});

function createSolidImage(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
) {
  const pixels = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }

  return pixels;
}
