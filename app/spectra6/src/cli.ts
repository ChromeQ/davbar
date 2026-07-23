#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { decodeSpectra6, encodeSpectra6 } from "./index.js";

async function main() {
  const [, , input, outputDir = "./out"] = process.argv;

  if (!input) {
    console.error("Usage: spectra6 <image> [output-directory]");
    process.exit(1);
  }

  const { data, info } = await sharp(input)
    .resize(400, 600, {
      fit: "cover",
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const baseName = path.parse(input).name;

  // Encode the image to Spectra 6 format
  const image = encodeSpectra6(data, info.width, info.height);

  // Header file
  const header = createHeader(image.bytes);
  const headerOutput = path.join(outputDir, `${baseName}.h`);
  await fs.writeFile(headerOutput, header);

  // Bin file
  const binaryOutput = path.join(outputDir, `${baseName}.bin`);
  await fs.writeFile(binaryOutput, image.bytes);

  // Preview PNG
  const previewOutput = path.join(outputDir, `${baseName}.preview.png`);
  const decoded = decodeSpectra6(image.bytes, image.width, image.height);
  await sharp(decoded.pixels, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 3,
    },
  })
    .png()
    .toFile(previewOutput);

  console.log(`✓ ${headerOutput}`);
  console.log(`✓ ${binaryOutput}`);
  console.log(`✓ ${previewOutput}`);
}

function createHeader(bytes: Uint8Array) {
  const lines = [
    "#pragma once",
    "",
    "#include <Arduino.h>",
    "",
    `const uint8_t IMAGE[${bytes.length}] = {`,
  ];

  for (let i = 0; i < bytes.length; i += 16) {
    lines.push(
      "    " +
        [...bytes.slice(i, i + 16)]
          .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
          .join(", ") +
        ",",
    );
  }

  lines.push("};");

  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
