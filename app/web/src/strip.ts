// Draws the keg strip, the 400 x 200 area below the image, the same way the tap's
// firmware does (esp32/lib/Strip/Strip.cpp), so the preview matches the screen
// pixel for pixel. strip.test.ts checks the two against each other, so keep any
// change here in step with Strip.cpp.
import {
  barFont,
  batteryFont,
  brain,
  leaf,
  noSignal,
  noSignalStrike,
  rowFont,
  warning,
  warningFill,
  type StripFont,
  type StripIcon,
} from './strip-glyphs';

export const STRIP_WIDTH = 400;
export const STRIP_HEIGHT = 200;
// 2 pixels a byte, the left one in the high 4 bits, like the rest of the screen.
const ROW_BYTES = STRIP_WIDTH / 2;
export const STRIP_SIZE = ROW_BYTES * STRIP_HEIGHT;

// The panel's colour codes
const BLACK = 0x0;
const WHITE = 0x1;
const YELLOW = 0x2;
const RED = 0x3;
const BLUE = 0x5;
const GREEN = 0x6;
// Not a panel code: drawn as 2 red pixels to 1 yellow, the mix the encoder makes of
// #FF5500.
const ORANGE = 0x10;

// What the strip shows, as the tap reports it at /strip. Values not known yet are
// null.
export type StripValues = {
  // false shows "No laser" and nothing else.
  laserChosen: boolean;
  // 1-3 dots, matching the laser's lid; 0 for a laser not in config/lasers.json.
  laserNumber: number;
  // The mode chosen for this tap, shown as the brain or leaf icon.
  mode: 'smart' | 'eco';
  percent: number | null;
  litresTenths: number | null;
  temperatureTenths: number | null;
  batteryPercent: number | null;
  // The laser has been in the other mode for over an hour.
  modeWarning: boolean;
  // Nothing heard from the laser for too long. Hides the mode warning.
  noSignal: boolean;
  // Test values from "Show on device", drawn with a red border.
  test: boolean;
};

const MARGIN = 16;

// The top row: the percentage, the middle group and the temperature, centred
// between the image and the bar.
const DOT_RADIUS = 4;
const DOT_GAP = 3;
const MAX_DOTS = 3;
const BATTERY_WIDTH = 52;
const BATTERY_HEIGHT = 26;
const BATTERY_BORDER = 3;
// Between the battery's outline and its fill
const BATTERY_INSET = 2;
const NUB_WIDTH = BATTERY_BORDER + 1;
const NUB_HEIGHT = 10;
const ICON_SIZE = 32;
const GROUP_GAP = 10;

// Around test values. The content keeps MARGIN from every edge, so the border never
// touches it.
const TEST_BORDER = 5;

// The level bar
const BAR_X = MARGIN;
const BAR_Y = 88;
const BAR_WIDTH = STRIP_WIDTH - MARGIN * 2;
const BAR_HEIGHT = 96;
const BAR_BORDER = 4;

// Integer division, rounding towards zero like C++.
const divide = (a: number, b: number) => Math.trunc(a / b);

const decodedBits = new Map<string, Uint8Array>();

const bitsOf = (base64: string) => {
  let bits = decodedBits.get(base64);
  if (!bits) {
    bits = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    decodedBits.set(base64, bits);
  }
  return bits;
};

class Canvas {
  constructor(readonly bytes: Uint8Array) {}

  set(x: number, y: number, colour: number) {
    if (x < 0 || x >= STRIP_WIDTH || y < 0 || y >= STRIP_HEIGHT) {
      return;
    }

    const paint = colour === ORANGE ? ((x + y) % 3 === 0 ? YELLOW : RED) : colour;
    const index = y * ROW_BYTES + (x >> 1);
    const byte = this.bytes[index]!;
    this.bytes[index] = x % 2 === 0 ? (byte & 0x0f) | (paint << 4) : (byte & 0xf0) | paint;
  }

  fillRect(x: number, y: number, width: number, height: number, colour: number) {
    for (let j = y; j < y + height; j++) {
      for (let i = x; i < x + width; i++) {
        this.set(i, j, colour);
      }
    }
  }

  strokeRect(x: number, y: number, width: number, height: number, border: number, colour: number) {
    this.fillRect(x, y, width, border, colour);
    this.fillRect(x, y + height - border, width, border, colour);
    this.fillRect(x, y, border, height, colour);
    this.fillRect(x + width - border, y, border, height, colour);
  }

  // The pixels within r + 0.3 of the centre, so small dots look round.
  disc(centreX: number, centreY: number, r: number, colour: number) {
    const limit = r * r * 10 + r * 6;
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if ((i * i + j * j) * 10 <= limit) {
          this.set(centreX + i, centreY + j, colour);
        }
      }
    }
  }
}

// Each pixel of some text is `before` left of column `split`, and `after` from it
// on, so text crossing the bar's fill contrasts with both sides.
type TextColour = { before: number; after: number; split: number };

const plain = (colour: number): TextColour => ({ before: colour, after: colour, split: 0 });

type Align = 'left' | 'centre' | 'right';

// 1-bit rows, each padded to whole bytes, the most significant bit on the left.
const drawBits = (
  canvas: Canvas,
  bits: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  colour: TextColour
) => {
  const rowBytes = (width + 7) >> 3;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (bits[j * rowBytes + (i >> 3)]! & (0x80 >> (i & 7))) {
        const px = x + i;
        canvas.set(px, y + j, px < colour.split ? colour.before : colour.after);
      }
    }
  }
};

const drawIcon = (canvas: Canvas, icon: StripIcon, x: number, y: number, colour: number) =>
  drawBits(canvas, bitsOf(icon.bits), icon.width, icon.height, x, y, plain(colour));

const kerning = (font: StripFont, first: string, second: string | undefined) =>
  second === undefined ? 0 : (font.kerning[first + second] ?? 0);

// How far some text moves the pen, in 1/16 px. Characters the font doesn't have
// are skipped.
const textAdvance = (font: StripFont, text: string) => {
  const characters = [...text];
  let advance = 0;
  characters.forEach((character, index) => {
    const glyph = font.glyphs[character];
    if (glyph) {
      advance += glyph.advance + kerning(font, character, characters[index + 1]);
    }
  });
  return advance;
};

// The pen moves in 1/16 px and each character lands on the nearest whole pixel.
const drawText = (
  canvas: Canvas,
  font: StripFont,
  text: string,
  x: number,
  baseline: number,
  align: Align,
  colour: TextColour
) => {
  const advance = textAdvance(font, text);
  let pen = x * 16;
  if (align === 'centre') {
    pen -= divide(advance, 2);
  } else if (align === 'right') {
    pen -= advance;
  }

  const characters = [...text];
  characters.forEach((character, index) => {
    const glyph = font.glyphs[character];
    if (!glyph) {
      return;
    }

    drawBits(
      canvas,
      bitsOf(glyph.bits),
      glyph.width,
      glyph.height,
      ((pen + 8) >> 4) + glyph.left,
      baseline + glyph.top,
      colour
    );
    pen += glyph.advance + kerning(font, character, characters[index + 1]);
  });
};

// Black, with a green fill in 10% steps. Below 10%: red, with a red fill and the
// percentage in 1% steps.
const drawBattery = (canvas: Canvas, x: number, y: number, batteryPercent: number) => {
  const percent = Math.min(batteryPercent, 100);
  const low = percent < 10;
  const outline = low ? RED : BLACK;
  canvas.strokeRect(x, y, BATTERY_WIDTH, BATTERY_HEIGHT, BATTERY_BORDER, outline);
  canvas.fillRect(
    x + BATTERY_WIDTH,
    y + divide(BATTERY_HEIGHT - NUB_HEIGHT, 2),
    NUB_WIDTH,
    NUB_HEIGHT,
    outline
  );

  const innerX = x + BATTERY_BORDER + BATTERY_INSET;
  const innerY = y + BATTERY_BORDER + BATTERY_INSET;
  const innerWidth = BATTERY_WIDTH - (BATTERY_BORDER + BATTERY_INSET) * 2;
  const innerHeight = BATTERY_HEIGHT - (BATTERY_BORDER + BATTERY_INSET) * 2;
  const fill = low
    ? divide(innerWidth * percent + 99, 100)
    : divide(innerWidth * divide(percent, 10) + 5, 10);
  canvas.fillRect(innerX, innerY, fill, innerHeight, low ? RED : GREEN);

  if (low) {
    const capTop = y + divide(BATTERY_HEIGHT - batteryFont.capHeight, 2);
    drawText(
      canvas,
      batteryFont,
      `${percent}%`,
      x + divide(BATTERY_WIDTH, 2),
      capTop + batteryFont.capHeight,
      'centre',
      { before: WHITE, after: RED, split: innerX + fill }
    );
  }
};

// Stacked vertically and centred on midY, so the group is the same width on every tap.
const drawDots = (canvas: Canvas, x: number, midY: number, count: number) => {
  const height = count * DOT_RADIUS * 2 + (count - 1) * DOT_GAP;
  for (let i = 0; i < count; i++) {
    const centreY = midY - divide(height, 2) + DOT_RADIUS + i * (DOT_RADIUS * 2 + DOT_GAP);
    canvas.disc(x + DOT_RADIUS, centreY, DOT_RADIUS, BLACK);
  }
};

// The laser dots, battery and mode icon, with the no signal icon or the mode
// warning when needed, centred on the screen so the icons line up across the taps.
const drawGroup = (canvas: Canvas, values: StripValues, midY: number) => {
  const showWarning = values.modeWarning && !values.noSignal;
  const width =
    DOT_RADIUS * 2 +
    GROUP_GAP +
    BATTERY_WIDTH +
    NUB_WIDTH +
    GROUP_GAP +
    ICON_SIZE +
    (values.noSignal || showWarning ? GROUP_GAP + ICON_SIZE : 0);
  let x = divide(STRIP_WIDTH, 2) - divide(width, 2);
  const iconY = midY - divide(ICON_SIZE, 2);

  drawDots(canvas, x, midY, Math.min(values.laserNumber, MAX_DOTS));
  x += DOT_RADIUS * 2 + GROUP_GAP;

  if (values.batteryPercent !== null) {
    drawBattery(canvas, x, midY - divide(BATTERY_HEIGHT, 2), values.batteryPercent);
  }
  x += BATTERY_WIDTH + NUB_WIDTH + GROUP_GAP;

  // Bluetooth's blue, crossed out in red.
  if (values.noSignal) {
    drawIcon(canvas, noSignal, x, iconY, BLUE);
    drawIcon(canvas, noSignalStrike, x, iconY, RED);
    x += ICON_SIZE + GROUP_GAP;
  }

  drawIcon(canvas, values.mode === 'eco' ? leaf : brain, x, iconY, BLACK);
  x += ICON_SIZE + GROUP_GAP;

  // Like a road sign: yellow inside, with a black outline and "!".
  if (showWarning) {
    drawIcon(canvas, warningFill, x, iconY, YELLOW);
    drawIcon(canvas, warning, x, iconY, BLACK);
  }
};

const drawTopRow = (canvas: Canvas, values: StripValues) => {
  const capTop = divide(BAR_Y - rowFont.capHeight, 2);
  const baseline = capTop + rowFont.capHeight;

  if (values.percent !== null) {
    drawText(canvas, rowFont, `${values.percent}%`, MARGIN, baseline, 'left', plain(BLACK));
  }

  if (values.temperatureTenths !== null) {
    const tenths = Math.abs(values.temperatureTenths);
    const sign = values.temperatureTenths < 0 ? '-' : '';
    const text = `${sign}${divide(tenths, 10)}.${tenths % 10}°`;
    drawText(canvas, rowFont, text, STRIP_WIDTH - MARGIN, baseline, 'right', plain(BLACK));
  }

  drawGroup(canvas, values, capTop + divide(rowFont.capHeight, 2));
};

// Green from 50%, orange from 25% and red below, with the litres centred.
const drawBar = (canvas: Canvas, values: StripValues) => {
  canvas.strokeRect(BAR_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, BAR_BORDER, BLACK);

  if (values.percent === null || values.litresTenths === null) {
    return;
  }

  const percent = Math.min(values.percent, 100);
  const innerX = BAR_X + BAR_BORDER;
  const innerY = BAR_Y + BAR_BORDER;
  const innerWidth = BAR_WIDTH - BAR_BORDER * 2;
  const innerHeight = BAR_HEIGHT - BAR_BORDER * 2;
  const fill = divide(innerWidth * percent + 50, 100);
  const colour = percent >= 50 ? GREEN : percent >= 25 ? ORANGE : RED;
  canvas.fillRect(innerX, innerY, fill, innerHeight, colour);

  const text = `${divide(values.litresTenths, 10)}.${values.litresTenths % 10}L`;
  const capTop = BAR_Y + divide(BAR_HEIGHT - barFont.capHeight, 2);
  // White over green and red, black over orange and the empty part.
  const onFill = colour === ORANGE ? BLACK : WHITE;
  drawText(canvas, barFont, text, divide(STRIP_WIDTH, 2), capTop + barFont.capHeight, 'centre', {
    before: onFill,
    after: BLACK,
    split: innerX + fill,
  });
};

// The strip as the panel's bytes: 2 pixels a byte, STRIP_SIZE bytes in all.
export const drawStrip = (values: StripValues): Uint8Array => {
  const canvas = new Canvas(new Uint8Array(STRIP_SIZE).fill((WHITE << 4) | WHITE));

  if (!values.laserChosen) {
    drawText(
      canvas,
      rowFont,
      'No laser',
      divide(STRIP_WIDTH, 2),
      divide(STRIP_HEIGHT + rowFont.capHeight, 2),
      'centre',
      plain(BLACK)
    );
    return canvas.bytes;
  }

  drawTopRow(canvas, values);
  drawBar(canvas, values);

  if (values.test) {
    canvas.strokeRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT, TEST_BORDER, RED);
  }

  return canvas.bytes;
};
