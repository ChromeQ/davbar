// The keg states, "Keg empty" and "Keg ready": always first in the Library, and
// drawn by the page when picked, so the date is that day's. Each is a pub
// chalkboard with a rubber stamp across it, a line in chalk above, and the date
// below. The line comes from config/keg-lines.json (see
// app/scripts/keg-lines.ts), never the one this browser took last time.
import { IMAGE_SIZE } from './screen';

export type KegState = 'empty' | 'ready';

export type KegLines = Record<KegState, string[]>;

declare const __KEG_LINES__: KegLines;

export const kegLines: KegLines = __KEG_LINES__;

export const KEG_STATES: KegState[] = ['empty', 'ready'];

export const kegStateName: Record<KegState, string> = {
  empty: 'Keg empty',
  ready: 'Keg ready',
};

// The panel's colours that the picture uses, so nothing is dithered but the
// chalk's edges.
const BLACK = '#000000';
const WHITE = '#ffffff';
const YELLOW = '#ffff00';
const RED = '#ff0000';
const GREEN = '#00ff00';

const look = {
  empty: { stamp: 'KEG EMPTY', stampColour: RED, lineColour: WHITE, dateWord: 'Kicked' },
  ready: { stamp: 'KEG READY', stampColour: GREEN, lineColour: YELLOW, dateWord: 'Cleaned' },
};

// "Kicked 9 Nov" or "Cleaned 9 Nov", the date as the Library writes it.
export const dateLine = (state: KegState, date: Date) =>
  `${look[state].dateWord} ${date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;

// A line from the list, never the one taken last time, unless it's the only one.
// random gives a number from 0 up to 1, like Math.random.
export const pickLine = (lines: string[], last: string | null, random = Math.random) => {
  const others = lines.filter((line) => line !== last);
  const choices = others.length > 0 ? others : lines;

  return choices[Math.floor(random() * choices.length)] ?? '';
};

// The line each state took last, remembered by this browser. Each tap's page is
// its own site to the browser, so each tap remembers its own. Nothing is
// remembered if the browser keeps nothing, as in a private window.
const memoryKey = (state: KegState) => `kegLine.${state}`;

export const lastLine = (state: KegState) => {
  try {
    return window.localStorage.getItem(memoryKey(state));
  } catch {
    return null;
  }
};

export const rememberLine = (state: KegState, line: string) => {
  try {
    window.localStorage.setItem(memoryKey(state), line);
  } catch {
    // Not remembered, so the next one may be the same.
  }
};

// The same specks each time for the same words.
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const seedOf = (words: string) =>
  [...words].reduce((seed, character) => Math.imul(seed, 31) + character.codePointAt(0)!, 7);

// Built into the app page (app.style.css). The stamp uses Roboto, as stamps are
// typeset.
const CHALK_FONT = '"Permanent Marker"';
const STAMP_FONT = 'Roboto';

// The largest size up to size that fits the words in maxWidth.
const fitFont = (
  context: CanvasRenderingContext2D,
  words: string,
  font: (size: number) => string,
  size: number,
  maxWidth: number
) => {
  let px = size;
  context.font = font(px);

  while (context.measureText(words).width > maxWidth && px > 10) {
    px -= 1;
    context.font = font(px);
  }
};

// Words in chalk, centred across the square, with tiny specks knocked out of the
// letters as chalk leaves on a board.
const chalk = (
  context: CanvasRenderingContext2D,
  words: string,
  baseline: number,
  size: number,
  colour: string
) => {
  const centre = IMAGE_SIZE / 2;

  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillStyle = colour;
  fitFont(context, words, (px) => `${px}px ${CHALK_FONT}`, size, 320);
  context.fillText(words, centre, baseline);

  const box = context.measureText(words);
  const left = centre - box.actualBoundingBoxLeft;
  const top = baseline - box.actualBoundingBoxAscent;
  const width = box.actualBoundingBoxLeft + box.actualBoundingBoxRight;
  const height = box.actualBoundingBoxAscent + box.actualBoundingBoxDescent;
  const random = seeded(seedOf(words));

  context.fillStyle = BLACK;
  for (let speck = 0; speck < Math.round((width * height) / 70); speck++) {
    context.beginPath();
    context.arc(
      left + random() * width,
      top + random() * height,
      0.5 + random() * 1.1,
      0,
      Math.PI * 2
    );
    context.fill();
  }

  context.restore();
};

// A worn rubber stamp across the middle, tilted slightly, its words centred in
// it however much they shrink to fit.
const stamp = (context: CanvasRenderingContext2D, words: string, colour: string) => {
  const halfWidth = 156;
  const halfHeight = 52;
  const spacing = 3;

  context.save();
  context.translate(IMAGE_SIZE / 2, IMAGE_SIZE / 2);
  context.rotate(-0.17);
  context.strokeStyle = colour;
  context.lineWidth = 9;
  context.beginPath();
  context.roundRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2, 12);
  context.stroke();
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(-halfWidth + 12, -halfHeight + 12, halfWidth * 2 - 24, halfHeight * 2 - 24, 8);
  context.stroke();

  context.fillStyle = colour;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.letterSpacing = `${spacing}px`;
  fitFont(context, words, (px) => `700 ${px}px ${STAMP_FONT}`, 62, halfWidth * 2 - 44);
  const box = context.measureText(words);
  // Letter spacing is added after the last letter too, so half of it is put back.
  context.fillText(
    words,
    spacing / 2,
    (box.actualBoundingBoxAscent - box.actualBoundingBoxDescent) / 2
  );

  const random = seeded(seedOf(words));
  context.fillStyle = BLACK;
  for (let speck = 0; speck < 170; speck++) {
    context.beginPath();
    context.arc(
      -halfWidth - 4 + random() * (halfWidth * 2 + 8),
      -halfHeight - 4 + random() * (halfHeight * 2 + 8),
      0.8 + random() * 2.2,
      0,
      Math.PI * 2
    );
    context.fill();
  }

  context.restore();
};

// The whole 400 x 400 picture.
export const drawKegState = (
  context: CanvasRenderingContext2D,
  state: KegState,
  line: string,
  date: Date
) => {
  const { stamp: stampWords, stampColour, lineColour } = look[state];

  // The board, with a double border
  context.fillStyle = BLACK;
  context.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  context.strokeStyle = WHITE;
  context.lineWidth = 4;
  context.strokeRect(18, 18, IMAGE_SIZE - 36, IMAGE_SIZE - 36);
  context.lineWidth = 2;
  context.strokeRect(29, 29, IMAGE_SIZE - 58, IMAGE_SIZE - 58);

  chalk(context, line, 98, 40, lineColour);
  stamp(context, stampWords, stampColour);
  chalk(context, dateLine(state, date), 338, 34, WHITE);
};

// Both fonts, loaded before drawing: a canvas doesn't redraw itself when a font
// arrives, and would keep a fallback.
const fontsLoaded = () =>
  Promise.all([
    document.fonts.load(`40px ${CHALK_FONT}`),
    document.fonts.load(`700 62px ${STAMP_FONT}`),
  ]);

// The picture as a PNG, to load into Compose like a beer's.
export const kegStatePicture = async (state: KegState, line: string, date: Date) => {
  await fontsLoaded().catch(() => undefined);

  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to draw the keg picture.');
  }

  drawKegState(context, state, line, date);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Unable to draw the keg picture.'))),
      'image/png'
    );
  });
};
