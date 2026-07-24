# DavBar Keg Display App

This pnpm workspace contains the software used to prepare content for the keg display:

- `web` is a React app for composing text or selecting a 400 x 600 image, previewing the result in the Spectra 6 palette, and uploading the encoded image to the display.
- `spectra6` provides the shared Spectra 6 encoder, decoder, dithering, palette, and command-line conversion tools.

Install dependencies with `pnpm install`, then run the web app with `pnpm --filter @chromeq/davbar-keg-display dev`.