import { SPECTRA6_PALETTE, type PaletteColour } from "./palette.js";

export function nearestColour(
  r?: number,
  g?: number,
  b?: number,
): PaletteColour {
  if (r === undefined || g === undefined || b === undefined) {
    throw new Error("Invalid RGB values");
  }

  let best = SPECTRA6_PALETTE[0];
  let bestDistance = Infinity;

  for (const colour of SPECTRA6_PALETTE) {
    const dr = r - colour.r;
    const dg = g - colour.g;
    const db = b - colour.b;

    const distance = dr * dr + dg * dg + db * db;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = colour;
    }
  }

  if (!best) {
    throw new Error("Invalid colour value");
  }

  return best;
}

export function clamp(value?: number) {
  if (value === undefined) {
    throw new Error("Invalid clamp value");
  }

  return Math.max(0, Math.min(255, value));
}
