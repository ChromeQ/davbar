import { SPECTRA6_PALETTE } from "./palette.js";

export type DecodedSpectra6 = {
  pixels: Uint8Array;
  width: number;
  height: number;
};

export function decodeSpectra6(
  bytes: Uint8Array,
  width: number,
  height: number,
): DecodedSpectra6 {
  const expected = (width * height) / 2;

  if (bytes.length !== expected) {
    throw new Error(
      `Invalid buffer length. Expected ${expected}, got ${bytes.length}`,
    );
  }

  const pixels = new Uint8Array(width * height * 3);

  for (let i = 0; i < width * height; i++) {
    const byte = bytes[Math.floor(i / 2)]!;
    const value = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
    const colour = SPECTRA6_PALETTE.find((c) => c.value === value);

    if (!colour) {
      throw new Error(`Unknown Spectra 6 colour value: ${value}`);
    }

    const offset = i * 3;

    pixels[offset] = colour.r;
    pixels[offset + 1] = colour.g;
    pixels[offset + 2] = colour.b;
  }

  return {
    pixels,
    width,
    height,
  };
}
