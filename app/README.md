# DavBar Keg Display App

This pnpm workspace contains the software used to prepare content for the keg display:

- `web` is a React app for composing text or selecting a 400 x 600 image, previewing the result in the Spectra 6 palette, and uploading the encoded image to the display.
- `spectra6` provides the shared Spectra 6 encoder, decoder, dithering, palette, and command-line conversion tools.

Install dependencies and use the workspace-level commands:

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
pnpm lint
pnpm test
```

Device branding and identity come from the shared profiles under `../config`. Use
`pnpm device:build`, `pnpm device:upload`, or `pnpm device:upload:fs` so the web app
and firmware use the same profile. See the [project README](../README.md) for the
profile schema and complete device workflow.