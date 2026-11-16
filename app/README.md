# DavBar Keg Display App

This pnpm workspace contains the software used to prepare content for the keg display:

- `web` is the React app each tap serves: composing text or an image for the 400 x 400 square (or the whole screen on a tap with no laser), the beer library and keg states, previewing the whole screen with the keg strip in the Spectra 6 palette, and Upload to display. See [the web app](../docs/web-app.md).
- `spectra6` provides the shared Spectra 6 encoder, decoder, dithering, palette, and command-line conversion tools.
- `rapt-laser` decodes the Bluetooth advertisements of a RAPT Laser Level Sensor and converts its distance reading to the litres and percentage left in the keg, with the same keg table as the firmware (see [the sensor](../docs/rapt-laser-sensor.md)). To decode one by hand, paste the hex from nRF Connect (the payload, the manufacturer data or the whole advertisement): `pnpm --dir rapt-laser decode <hex>`.

Install dependencies and use the workspace-level commands:

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
pnpm lint
pnpm lint:fix
pnpm test
```

`pnpm lint` runs ESLint on the workspace's `scripts` and then on each package. ESLint
also checks the code (and the web app's CSS) against Prettier's format, using
`eslint-plugin-prettier`, so `pnpm lint` fails on unformatted files and
`pnpm lint:fix` rewrites them. The Prettier settings are in `.prettierrc`, shared by
every package.

`pnpm strip:glyphs` turns Roboto Bold, Permanent Marker (the setup help's titles) and
the strip's Lucide icons into 1-bit pixel tables for the firmware
(`../esp32/lib/Strip/StripGlyphs.cpp`) and the web app (`web/src/strip-glyphs.ts`), so
both draw the keg strip with the same pixels. Run it after changing a size, a
character or an icon in `scripts/strip-glyphs.ts`, and commit the generated files.
`--preview <file.png>` also saves an enlarged picture of them.

`pnpm fonts:subset` trims Roboto and Permanent Marker to the weights and characters
the pages use (`web/src/fonts`), as both are built into the pages rather than loaded
from the internet. Run it after the pages need a new character, and commit the
files.

The build checks the keg states' chalk lines in `../config/keg-lines.json`: at most
24 characters each, and only characters the chalk font has.

Device branding and identity come from the shared profiles under `../config`. Use
`pnpm device:build`, `pnpm device:upload`, or `pnpm device:upload:fs` so the web app
and firmware use the same profile. See the [project README](../README.md) for the
profile schema and complete device workflow.
