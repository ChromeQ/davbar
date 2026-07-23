export type PaletteColour = {
  r: number;
  g: number;
  b: number;
  value: number;
};

export const SPECTRA6_PALETTE: PaletteColour[] = [
  { r: 0, g: 0, b: 0, value: 0x0 }, // Black
  { r: 255, g: 255, b: 255, value: 0x1 }, // White
  { r: 255, g: 255, b: 0, value: 0x2 }, // Yellow
  { r: 255, g: 0, b: 0, value: 0x3 }, // Red
  { r: 0, g: 0, b: 255, value: 0x5 }, // Blue
  { r: 0, g: 255, b: 0, value: 0x6 }, // Green
];
