// How the page drew a picture, kept on the tap with it (source with POST
// /image, image.source in GET /status), so it can be drawn again: a keg state,
// or text. A picture drawn for one layout doesn't suit the other: a keg state's
// border goes round the square or the whole screen, and text is centred on
// either. So with nothing in Compose, a new layout draws the tap's picture again
// for it, with the same line and date or words (PLAN.md, step 8f).
import { isObject } from './device-json';
import { KEG_STATES, type KegState } from './keg-states';
import type { Background, BackgroundStyle } from './screen';

// The fonts text can be written in.
export const TEXT_FONTS = ['Roboto', 'Georgia', 'Arial', 'Verdana', 'Courier New'];

export type PictureSource =
  | { kind: 'keg'; state: KegState; line: string; date: string }
  | {
      kind: 'text';
      text: string;
      font: string;
      size: number;
      colour: string;
      background: Background;
    };

// The most the tap keeps (MaxImageSourceLength in esp32/src/ImageManager.h).
export const MAX_SOURCE_BYTES = 1024;

// As the tap keeps it, or null if it's too long to keep, when the picture goes
// without it and is worked from its pixels.
export const sourceText = (source: PictureSource) => {
  const text = JSON.stringify(source);

  return new TextEncoder().encode(text).length <= MAX_SOURCE_BYTES ? text : null;
};

const COLOUR = /^#[0-9a-f]{6}$/i;
const STYLES: BackgroundStyle[] = ['solid', 'linear', 'radial', 'blur'];

const isColour = (value: unknown): value is string =>
  typeof value === 'string' && COLOUR.test(value);

const readBackground = (value: unknown): Background | null =>
  isObject(value) &&
  STYLES.includes(value.style as BackgroundStyle) &&
  isColour(value.colour) &&
  isColour(value.endColour)
    ? { style: value.style as BackgroundStyle, colour: value.colour, endColour: value.endColour }
    : null;

// The tap's image.source, or null when there's none or it can't be read, when
// the picture is worked from its pixels instead.
export const readPictureSource = (value: unknown): PictureSource | null => {
  if (typeof value !== 'string') {
    return null;
  }

  let source: unknown;

  try {
    source = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isObject(source)) {
    return null;
  }

  if (source.kind === 'keg') {
    const { state, line, date } = source;

    return KEG_STATES.includes(state as KegState) &&
      typeof line === 'string' &&
      typeof date === 'string' &&
      !Number.isNaN(Date.parse(date))
      ? { kind: 'keg', state: state as KegState, line, date }
      : null;
  }

  if (source.kind === 'text') {
    const { text, font, size, colour } = source;
    const background = readBackground(source.background);

    return typeof text === 'string' &&
      typeof font === 'string' &&
      TEXT_FONTS.includes(font) &&
      typeof size === 'number' &&
      Number.isFinite(size) &&
      size > 0 &&
      isColour(colour) &&
      background
      ? { kind: 'text', text, font, size, colour, background }
      : null;
  }

  return null;
};
