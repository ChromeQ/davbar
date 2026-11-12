// Turns Roboto Bold, Permanent Marker and the strip's Lucide icons into 1-bit
// pixel tables, so the tap's firmware can draw the strip and the setup help without
// a font library.
// The web app gets the strip's tables, so its preview of the strip matches the
// screen pixel for pixel; it shows the setup help as the tap draws it.
//
// Usage (from app/): pnpm strip:glyphs [--preview <file.png>]
// Run it after changing a size, a character or an icon below, and commit the
// generated files. --preview also saves an enlarged picture of every glyph.
import fs from 'node:fs';
import path from 'node:path';

import { openSync, type Font as FontkitFont } from 'fontkit';
import { format, resolveConfig } from 'prettier';
import sharp from 'sharp';

import { repositoryDirectory } from './device-config.ts';

// The typefaces, from their fontsource packages: Roboto Bold for most, and
// Permanent Marker, the keg states' chalk (Apache License 2.0), for the setup
// help's titles.
const typefaces = {
  roboto: {
    name: 'Roboto Bold',
    file: '@fontsource/roboto/files/roboto-latin-700-normal.woff2',
  },
  marker: {
    name: 'Permanent Marker',
    file: '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2',
  },
} as const;

type Typeface = keyof typeof typefaces;

type FontSpec = {
  name: string;
  // Roboto Bold unless given.
  typeface?: Typeface;
  size: number;
  characters: string;
  use: string;
  // Left out of the web app, which never draws with it.
  firmwareOnly?: boolean;
};

// Every printable ASCII character, for text from the tap's profile.
const ascii = String.fromCodePoint(
  ...Array.from({ length: 0x7f - 0x20 }, (_, index) => 0x20 + index)
);

// Only the characters each size needs. Add one here before the firmware uses it.
const fontSpecs: FontSpec[] = [
  {
    name: 'batteryFont',
    size: 16,
    characters: '0123456789%',
    use: 'the percentage in a low battery',
  },
  {
    name: 'rowFont',
    size: 40,
    characters: '0123456789%.°- Nolaser',
    use: 'the top row',
  },
  {
    name: 'barFont',
    size: 64,
    characters: '0123456789.L',
    use: 'the litres in the bar',
  },
  {
    name: 'helpTitleFont',
    typeface: 'marker',
    size: 38,
    characters: ascii,
    use: "the setup help's title",
    firmwareOnly: true,
  },
  {
    name: 'helpFont',
    size: 22,
    characters: ascii,
    use: "the setup help's text",
    firmwareOnly: true,
  },
];

// Lucide icons (lucide.dev), drawn at 32px with Lucide's 2px stroke on its 24px grid.
// ISC License, Copyright (c) 2026 Lucide Icons and Contributors.
const iconSize = 32;

type IconSpec = {
  name: string;
  use: string;
  paths: string[];
  // Filled instead of outlined, for an icon's inside drawn in another colour.
  fill?: boolean;
};

const warningTriangle = 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3';

const iconSpecs: IconSpec[] = [
  {
    name: 'brain',
    use: 'Smart mode',
    paths: [
      'M12 18V5',
      'M15 13a4.17 4.17 0 01-3-4 4.17 4.17 0 01-3 4',
      'M17.707 6.294A3 3 0 1012 5a3 3 0 10-5.707 1.294',
      'M17.996 5.125a4 4 0 012.526 5.77',
      'M18 18a4 4 0 002-7.465',
      'M19.967 17.482a4 4 0 11-7.967.517 4 4 0 11-7.967-.517',
      'M6 18a4 4 0 01-2-7.465',
      'M6.004 5.125a4 4 0 00-2.526 5.77',
    ],
  },
  {
    name: 'leaf',
    use: 'Eco (Ultra Low Power) mode',
    paths: [
      'M11 20a10 10 0 0010-10 25.9 25.9 0 00-1.04-7.281 1 1 0 00-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0011 20',
      'M2 21a5 5 0 012.911-4.544C7.613 15.212 8.351 15.24 11 13',
    ],
  },
  {
    name: 'warning',
    use: 'the laser is in the other mode',
    paths: [warningTriangle, 'M12 9v4', 'M12 17h.01'],
  },
  {
    name: 'warningFill',
    use: 'the inside of the warning sign, drawn yellow under it',
    paths: [warningTriangle],
    fill: true,
  },
  {
    // Lucide's bluetooth-off, in two colours: the Bluetooth symbol, then the strike.
    name: 'noSignal',
    use: 'nothing heard from the laser: the Bluetooth symbol, drawn blue',
    paths: ['m17 17-5 5V12l-5 5', 'M14.5 9.5 17 7l-5-5v4.5'],
  },
  {
    name: 'noSignalStrike',
    use: 'the line through the Bluetooth symbol, drawn red over it',
    paths: ['m2 2 20 20'],
  },
];

const appDirectory = path.join(repositoryDirectory, 'app');
const cppDirectory = path.join(repositoryDirectory, 'esp32/lib/Strip');
const tsPath = path.join(appDirectory, 'web/src/strip-glyphs.ts');

// A pixel counts as drawn when at least half of it is covered, as the screen has
// no greys to show the edges with.
const threshold = 128;

type Bitmap = { width: number; height: number; pixels: Uint8Array };

type Glyph = Bitmap & {
  character: string;
  // From the pen to the first column, and from the baseline to the first row
  // (negative above it), in pixels.
  left: number;
  top: number;
  // How far the pen moves, in 1/16 px.
  advance: number;
};

type Font = FontSpec & {
  capHeight: number;
  glyphs: Glyph[];
  // Pairs of characters whose spacing the typeface adjusts, in 1/16 px.
  kerning: Array<{ first: string; second: string; adjust: number }>;
};

type Icon = Bitmap & { name: string; use: string };

const toSixteenths = (pixels: number) => Math.round(pixels * 16);

// Draws an SVG at 1 unit a pixel and keeps the pixels at least half covered.
const rasterise = async (svg: string, width: number, height: number): Promise<Bitmap> => {
  const { data } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = data[i * 4 + 3]! >= threshold ? 1 : 0;
  return { width, height, pixels };
};

// Cuts a bitmap down to its drawn pixels, returning how far it moved.
const trim = (bitmap: Bitmap) => {
  let minX = bitmap.width;
  let minY = bitmap.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (!bitmap.pixels[y * bitmap.width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return { bitmap: { width: 0, height: 0, pixels: new Uint8Array() }, dx: 0, dy: 0 };
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels[y * width + x] = bitmap.pixels[(y + minY) * bitmap.width + x + minX]!;
    }
  }
  return { bitmap: { width, height, pixels }, dx: minX, dy: minY };
};

const loaded = new Map<Typeface, FontkitFont>();

const loadTypeface = (typeface: Typeface): FontkitFont => {
  const known = loaded.get(typeface);
  if (known) return known;

  const file = path.join(appDirectory, 'node_modules', typefaces[typeface].file);
  const font = openSync(file);
  if (!('glyphForCodePoint' in font)) throw new Error(`${file} is a font collection`);
  loaded.set(typeface, font);
  return font;
};

const typefaceOf = (spec: FontSpec) => typefaces[spec.typeface ?? 'roboto'];

const buildFont = async (spec: FontSpec): Promise<Font> => {
  const typeface = loadTypeface(spec.typeface ?? 'roboto');
  const scale = spec.size / typeface.unitsPerEm;
  const characters = [...new Set(spec.characters)].sort();
  const glyphs: Glyph[] = [];

  for (const character of characters) {
    const glyph = typeface.glyphForCodePoint(character.codePointAt(0)!);
    if (glyph.id === 0) throw new Error(`${typefaceOf(spec).name} has no "${character}"`);
    const { minX, minY, maxX, maxY } = glyph.bbox;
    // A whole-pixel box around the outline, with the pen at x 0 and the baseline at y 0.
    const left = Math.floor(minX * scale) - 1;
    const top = Math.floor(-maxY * scale) - 1;
    const width = Math.max(1, Math.ceil(maxX * scale) + 1 - left);
    const height = Math.max(1, Math.ceil(-minY * scale) + 1 - top);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}"><path transform="scale(${scale} ${-scale})" d="${glyph.path.toSVG()}"/></svg>`;
    const { bitmap, dx, dy } = trim(await rasterise(svg, width, height));
    glyphs.push({
      character,
      ...bitmap,
      left: bitmap.width ? left + dx : 0,
      top: bitmap.height ? top + dy : 0,
      advance: toSixteenths(glyph.advanceWidth * scale),
    });
  }

  const kerning: Font['kerning'] = [];
  for (const first of characters) {
    for (const second of characters) {
      const run = typeface.layout(first + second);
      const adjust = run.positions[0]!.xAdvance - run.glyphs[0]!.advanceWidth;
      const sixteenths = toSixteenths(adjust * scale);
      if (sixteenths !== 0) kerning.push({ first, second, adjust: sixteenths });
    }
  }

  const capHeight = Math.round(typeface.capHeight * scale);
  return { ...spec, capHeight, glyphs, kerning };
};

const buildIcon = async (spec: IconSpec): Promise<Icon> => {
  const paths = spec.paths.map((d) => `<path d="${d}"/>`).join('');
  const paint = spec.fill
    ? 'fill="#000" stroke="none"'
    : 'fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" ${paint}>${paths}</svg>`;
  return { name: spec.name, use: spec.use, ...(await rasterise(svg, iconSize, iconSize)) };
};

// 1 bit a pixel, each row padded to whole bytes, the most significant bit on the left.
const packBits = (bitmap: Bitmap) => {
  const rowBytes = Math.ceil(bitmap.width / 8);
  const bytes = new Uint8Array(rowBytes * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (bitmap.pixels[y * bitmap.width + x]) bytes[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return bytes;
};

const latin1 = (character: string) => {
  const code = character.codePointAt(0)!;
  if (code > 0xff) throw new Error(`"${character}" isn't Latin-1`);
  return code;
};

const cppCharacter = (character: string) => {
  const code = latin1(character);
  if (code < 0x20 || code > 0x7e) return `0x${code.toString(16).toUpperCase()}`;
  return character === "'" || character === '\\' ? `'\\${character}'` : `'${character}'`;
};

const cppBytes = (bytes: Uint8Array, indent: string) => {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const line = [...bytes.subarray(i, i + 16)].map(
      (byte) => `0x${byte.toString(16).padStart(2, '0')}`
    );
    lines.push(`${indent}${line.join(', ')},`);
  }
  return lines.join('\n');
};

const generatedNote = (comment: string) =>
  [
    `${comment} Generated by app/scripts/strip-glyphs.ts from Roboto Bold, Permanent Marker and Lucide icons.`,
    `${comment} Don't edit it: change the script and run pnpm strip:glyphs from app/.`,
  ].join('\n');

const writeCppHeader = (fonts: Font[], icons: Icon[]) => {
  const fontLines = fonts.map(
    (font) => `    extern const Font ${font.name}; // ${font.size}px, ${font.use}`
  );
  const iconLines = icons.map((icon) => `    extern const Icon ${icon.name}; // ${icon.use}`);
  return `${generatedNote('//')}
#pragma once

#include <stdint.h>

// Roboto Bold, Permanent Marker and the strip's icons as 1-bit pixels, for the
// strip and the setup help: each row is padded to whole bytes, with the most
// significant bit on the left.
namespace StripGlyphs
{
    struct Glyph
    {
        // Latin-1, so the degree sign is 0xB0.
        uint8_t code;
        uint8_t width;
        uint8_t height;
        // From the pen to the first column, and from the baseline to the first
        // row (negative above it), in pixels.
        int8_t left;
        int8_t top;
        // How far the pen moves afterwards, in 1/16 px.
        uint16_t advance;
        // Where its rows start in the font's bits.
        uint16_t offset;
    };

    // Added to the first character's advance when the second follows it.
    struct Kerning
    {
        uint8_t first;
        uint8_t second;
        // In 1/16 px.
        int16_t adjust;
    };

    struct Font
    {
        uint8_t size;
        // The height of a capital letter, in pixels.
        uint8_t capHeight;
        uint8_t glyphCount;
        const Glyph* glyphs;
        const uint8_t* bits;
        uint16_t kerningCount;
        const Kerning* kerning;
    };

    struct Icon
    {
        uint8_t width;
        uint8_t height;
        const uint8_t* bits;
    };

${fontLines.join('\n')}

${iconLines.join('\n')}
}
`;
};

const writeCppSource = (fonts: Font[], icons: Icon[]) => {
  const sections = fonts.map((font) => {
    let offset = 0;
    const bits: number[] = [];
    const glyphLines = font.glyphs.map((glyph) => {
      const packed = packBits(glyph);
      const line = `        { ${cppCharacter(glyph.character)}, ${glyph.width}, ${glyph.height}, ${glyph.left}, ${glyph.top}, ${glyph.advance}, ${offset} },`;
      bits.push(...packed);
      offset += packed.length;
      return line;
    });
    const kerningName = `${font.name}Kerning`;
    const kerning = font.kerning.length
      ? `    static const Kerning ${kerningName}[] = {\n${font.kerning
          .map(
            (pair) =>
              `        { ${cppCharacter(pair.first)}, ${cppCharacter(pair.second)}, ${pair.adjust} },`
          )
          .join('\n')}\n    };\n\n`
      : '';
    return `    // ${typefaceOf(font).name} ${font.size}px: ${font.glyphs.map((glyph) => glyph.character).join('')}
    static const uint8_t ${font.name}Bits[] = {
${cppBytes(Uint8Array.from(bits), '        ')}
    };

    static const Glyph ${font.name}Glyphs[] = {
${glyphLines.join('\n')}
    };

${kerning}    const Font ${font.name} = {
        ${font.size},
        ${font.capHeight},
        ${font.glyphs.length},
        ${font.name}Glyphs,
        ${font.name}Bits,
        ${font.kerning.length},
        ${font.kerning.length ? kerningName : 'nullptr'},
    };`;
  });

  const iconSections = icons.map(
    (icon) => `    static const uint8_t ${icon.name}Bits[] = {
${cppBytes(packBits(icon), '        ')}
    };

    const Icon ${icon.name} = { ${icon.width}, ${icon.height}, ${icon.name}Bits };`
  );

  return `${generatedNote('//')}
#include "StripGlyphs.h"

namespace StripGlyphs
{
${[...sections, ...iconSections].join('\n\n')}
}
`;
};

const writeTypeScript = async (fonts: Font[], icons: Icon[]) => {
  const base64 = (bitmap: Bitmap) => Buffer.from(packBits(bitmap)).toString('base64');
  const fontSource = fonts.map((font) => {
    const glyphs = Object.fromEntries(
      font.glyphs.map((glyph) => [
        glyph.character,
        {
          width: glyph.width,
          height: glyph.height,
          left: glyph.left,
          top: glyph.top,
          advance: glyph.advance,
          bits: base64(glyph),
        },
      ])
    );
    const kerning = Object.fromEntries(
      font.kerning.map((pair) => [pair.first + pair.second, pair.adjust])
    );
    return `// ${font.size}px, ${font.use}.
export const ${font.name}: StripFont = ${JSON.stringify({
      size: font.size,
      capHeight: font.capHeight,
      glyphs,
      kerning,
    })};`;
  });
  const iconSource = icons.map(
    (icon) => `// ${icon.use}.
export const ${icon.name}: StripIcon = ${JSON.stringify({
      width: icon.width,
      height: icon.height,
      bits: base64(icon),
    })};`
  );
  const source = `${generatedNote('//')}

// 1 bit a pixel in base64: each row is padded to whole bytes, with the most
// significant bit on the left. The same tables as esp32/lib/Strip/StripGlyphs.cpp.
export type StripGlyph = {
  width: number;
  height: number;
  // From the pen to the first column, and from the baseline to the first row
  // (negative above it), in pixels.
  left: number;
  top: number;
  // How far the pen moves afterwards, in 1/16 px.
  advance: number;
  bits: string;
};

export type StripFont = {
  size: number;
  // The height of a capital letter, in pixels.
  capHeight: number;
  glyphs: Record<string, StripGlyph>;
  // Added to the first character's advance when the second follows it, in 1/16 px.
  kerning: Record<string, number>;
};

export type StripIcon = { width: number; height: number; bits: string };

${[...fontSource, ...iconSource].join('\n\n')}
`;
  const options = await resolveConfig(tsPath);
  return format(source, { ...options, filepath: tsPath });
};

// An enlarged picture of every glyph and icon, and some strip text drawn from the
// tables, to check them by eye.
const writePreview = async (fonts: Font[], icons: Icon[], file: string) => {
  const lineWidth = (font: Font) =>
    Math.ceil(font.glyphs.reduce((total, glyph) => total + glyph.advance, 0) / 16) + 16;
  const width = Math.max(520, ...fonts.map(lineWidth));
  const height = fonts.reduce((total, font) => total + font.size + 8, 8) + 220;
  const canvas = new Uint8Array(width * height);
  const blit = (bitmap: Bitmap, x: number, y: number) => {
    for (let j = 0; j < bitmap.height; j++) {
      for (let i = 0; i < bitmap.width; i++) {
        const px = x + i;
        const py = y + j;
        if (bitmap.pixels[j * bitmap.width + i] && px >= 0 && px < width && py >= 0 && py < height)
          canvas[py * width + px] = 1;
      }
    }
  };
  // The pen moves in 1/16 px, and each glyph lands on the nearest whole pixel.
  const text = (font: Font, value: string, x: number, baseline: number) => {
    let pen = x * 16;
    [...value].forEach((character, index) => {
      const glyph = font.glyphs.find((candidate) => candidate.character === character);
      if (!glyph) throw new Error(`${font.name} has no "${character}"`);
      blit(glyph, Math.round(pen / 16) + glyph.left, baseline + glyph.top);
      const next = value[index + 1];
      const pair = font.kerning.find((item) => item.first === character && item.second === next);
      pen += glyph.advance + (pair?.adjust ?? 0);
    });
  };

  let y = 8;
  for (const font of fonts) {
    text(font, font.glyphs.map((glyph) => glyph.character).join(''), 8, y + font.capHeight);
    y += font.size + 8;
  }
  icons.forEach((icon, index) => blit(icon, 8 + index * (iconSize + 12), y));
  y += iconSize + 16;
  const row = fonts.find((font) => font.name === 'rowFont')!;
  const bar = fonts.find((font) => font.name === 'barFont')!;
  const battery = fonts.find((font) => font.name === 'batteryFont')!;
  text(row, '62%', 8, y + row.capHeight);
  text(row, '18.3°', 230, y + row.capHeight);
  text(battery, '7%', 140, y + row.capHeight);
  y += row.size + 8;
  text(bar, '11.7L', 8, y + bar.capHeight);

  const scale = 3;
  const rgb = Buffer.alloc(width * height * 3, 255);
  canvas.forEach((on, i) => {
    if (on) rgb.fill(0, i * 3, i * 3 + 3);
  });
  await sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize(width * scale, height * scale, { kernel: 'nearest' })
    .png()
    .toFile(file);
};

const fonts: Font[] = [];
for (const spec of fontSpecs) fonts.push(await buildFont(spec));
const icons: Icon[] = [];
for (const spec of iconSpecs) icons.push(await buildIcon(spec));

fs.mkdirSync(cppDirectory, { recursive: true });
fs.writeFileSync(path.join(cppDirectory, 'StripGlyphs.h'), writeCppHeader(fonts, icons));
fs.writeFileSync(path.join(cppDirectory, 'StripGlyphs.cpp'), writeCppSource(fonts, icons));
fs.writeFileSync(
  tsPath,
  await writeTypeScript(
    fonts.filter((font) => !font.firmwareOnly),
    icons
  )
);

for (const font of fonts) {
  const bytes = font.glyphs.reduce((total, glyph) => total + packBits(glyph).length, 0);
  console.log(
    `${font.name}: ${font.size}px, ${font.glyphs.length} characters, ${bytes} bytes, ${font.kerning.length} kerning pairs`
  );
}
console.log(`Icons: ${icons.map((icon) => icon.name).join(', ')}, ${iconSize}px`);

const previewIndex = process.argv.indexOf('--preview');
if (previewIndex >= 0) {
  const file = process.argv[previewIndex + 1];
  if (!file) throw new Error('--preview needs a file name, for example --preview glyphs.png');
  await writePreview(fonts, icons, path.resolve(file));
  console.log(`Preview: ${path.resolve(file)}`);
}
