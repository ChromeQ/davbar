# DavBar Keg Display App

This pnpm workspace contains the software used to prepare content for the keg display:

- `web` is a React app for composing text or selecting a 400 x 600 image, previewing the result in the Spectra 6 palette, and uploading the encoded image to the display.
- `spectra6` provides the shared Spectra 6 encoder, decoder, dithering, palette, and command-line conversion tools.
- `rapt-laser` decodes the Bluetooth advertisements of a RAPT Laser Level Sensor and converts its distance reading to the litres and percentage left in the keg. To decode one by hand, paste the hex from nRF Connect (the payload, the manufacturer data or the whole advertisement): `pnpm --dir rapt-laser decode <hex>`.

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

Device branding and identity come from the shared profiles under `../config`. Use
`pnpm device:build`, `pnpm device:upload`, or `pnpm device:upload:fs` so the web app
and firmware use the same profile. See the [project README](../README.md) for the
profile schema and complete device workflow.
