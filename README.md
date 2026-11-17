# DavBar Keg Display

DavBar Keg Display is a system for showing each beer's picture, and how full its keg is, on a six-colour e-paper display mounted to a keg tap. The level comes over Bluetooth from a RAPT Laser Level Sensor in the keg's lid. It includes a web app for composing, previewing and uploading pictures, plus the ESP32 firmware that draws them.

- [App and image tooling](app/README.md)
- [ESP32 firmware](esp32/README.md)
- [The display](docs/display.md): the screen, the keg strip and when it redraws
- [The web app](docs/web-app.md): composing pictures, the beer library and the keg states
- [The RAPT Laser Level Sensor](docs/rapt-laser-sensor.md): its broadcasts, and how a distance becomes litres
- [Past plans](docs/plans/): how each feature was planned and built, and the ideas left for later

## How the device works

The device is powered over USB and always on.

1. **Setup.** If no Wi-Fi network is saved, the device starts a setup access point
   (`DavBar Tap 1` with the `tap-1` profile). Connecting to it opens a captive
   "Set up Tap 1" page: one form that scans for nearby networks, then lists the
   lasers (choosing one can be skipped). Save sends the laser first, then the
   device tests the selected network before saving it, then reboots, which closes
   the page. If the saved network drops, the device retries every 30 seconds, and
   after 5 minutes without Wi-Fi it also opens the setup access point until Wi-Fi
   is back.
2. **Web app.** Once connected, the device serves the web app at
   `http://<hostname>-<deviceId>.local` (`http://davbar-tap1.local` with the
   `tap-1` profile). Compose text or choose an image for the 400 x 400 square, pick
   one from the beer library or a keg state, check the Spectra 6 preview, and press
   Upload to display. The Laser button beside it shows the tap's laser and opens a
   dialog to change it, or its mode (Smart or Eco). See [the web app](docs/web-app.md).
3. **Display.** The picture fills the top of the screen, and below it the tap draws
   the keg strip from its laser's readings: the percentage, litres, temperature and
   the laser's battery. It redraws only when something shown changes, such as a pour.
   With no picture saved, it draws setup help, with a QR code. A tap can also have no
   laser on purpose, and then the picture fills the whole screen. See
   [the display](docs/display.md).

The web app's device settings menu can show the device status, force a display
refresh, download the device log, reboot the device, or factory reset it. A
factory reset clears the saved Wi-Fi network, laser and screen image, then reboots
into setup mode. It keeps the log unless "Also clear the log" is ticked.

The device log records events such as boots and why they happened, Wi-Fi drops
and reconnects (with the reason), the setup access point opening and closing,
uploads, laser readings, beers saved or removed, and redraws (with the reason and
how long they took). It holds about the last 1 MB of entries, and survives uploads
and firmware updates.

## Prerequisites

- Node.js 26 and pnpm 11
- PlatformIO installed at `~/.platformio/penv/bin/platformio`
- `rsync`
- USB access to a Seeed Studio XIAO ESP32-S3 for upload commands

Install the JavaScript dependencies from the app workspace:

```bash
cd app
pnpm install
```

## Development commands

Run these commands from `app`:

```bash
pnpm dev       # Start the Vite development server
pnpm build     # Build the web app into web/dist
pnpm preview   # Preview the production web build
pnpm lint      # Lint all workspace packages
pnpm test      # Test all workspace packages
```

The build makes each page (the app and the Wi-Fi setup page) a single gzipped HTML
file with its script and styles inside: `web/dist/index.html.gz` and
`web/dist/connect.html.gz`. Every file a browser downloads at the same time costs the
ESP32 12-20 KB of memory it can't spare, so a page load is one download. The
device commands copy these files to `esp32/data`, and `pnpm preview` serves them the
same way the device does.

To open the Vite server from another device on the same network, expose it on all
interfaces:

```bash
pnpm dev --host 0.0.0.0
```

## Device profiles

Each tap has a JSON profile under `config`: `tap-1.json`, `tap-2.json` and
`tap-3.json`. `example.json` shows the format:

```json
{
	"brandName": "MyBar",
	"deviceName": "Tap 1",
	"deviceId": "tap1",
	"hostname": "mybar"
}
```

All four properties are required non-empty strings. `hostname` must contain only
lowercase letters, numbers, and internal hyphens. `deviceId` is not validated, but
it becomes part of the device's network name, so it should follow the same rule.

A tap's profile can also have `fit`, how its screen sits in its case's window, built
into the firmware:

```json
"fit": { "shiftX": 0, "shiftY": -1, "bottomSlant": 0 }
```

`shiftX` and `shiftY` move the whole screen right and down (negative for left and
up), and `bottomSlant` makes the bottom 200 rows follow a window edge that's higher
at the right. Each is a whole number of pixels from -30 to 30, and 0 if left out.
Changing it means uploading the firmware. See
[the display](docs/display.md#fitting-the-cases-window).

The build derives the following values from one profile:

| Input | Used for |
| --- | --- |
| `brandName` | Web branding, page titles, default display text, and output filename |
| `deviceName` | Human-readable device name and access-point name |
| `deviceId` | Suffix of the device's mDNS hostname, so devices sharing a `hostname` stay distinct |
| `hostname` | Prefix of the device's mDNS hostname, `<hostname>-<deviceId>.local` |
| `fit` | Where the firmware puts the screen in the case's window (optional) |

For `tap-1.json`, the setup access point is `DavBar Tap 1`, the device is reachable
at `davbar-tap1.local`, and the page titles and default display text use `DavBar`.

### Passwords

The passwords are shared by every tap and kept out of the repository in
`config/secrets.json`, which git ignores. Copy `config/secrets.example.json` and
set both:

```json
{
	"accessPointPassword": "8 to 63 characters",
	"otaPassword": "any password"
}
```

| Secret | Used for |
| --- | --- |
| `accessPointPassword` | Joining the setup access point, typed on a phone |
| `otaPassword` | Over-the-air uploads; the firmware only stores its hash |

Only the firmware build reads this file, so the passwords never reach the web
app. Firmware builds fail with a clear message if it is missing or still has the
example values.

### Lasers

`config/lasers.json` lists the RAPT Laser Level Sensors, numbered like the dots on
their lids. It is shared by every tap and built into the firmware, which uses the
numbers in the web app and the device log:

```json
[{ "number": 1, "address": "E5:4C:66:F9:E1:33" }]
```

Numbers are 1 to 9 and addresses are in capitals, as the RAPT app shows them.
Each tap's web app chooses which laser it shows.

### Keg lines

`config/keg-lines.json` lists the chalk lines for the "Keg empty" and "Keg ready"
boards. Add lines there without changing code; the build checks each one (at most 24
characters, and only characters the chalk font has). See
[the web app](docs/web-app.md#keg-states).

## Device commands

Run device commands from `app`, always choosing a tap's profile with `--config`
(or `DEVICE_CONFIG`), so nothing is built or uploaded for the wrong tap.

Build the web app and firmware without uploading:

```bash
pnpm device:build --config config/tap-1.json
```

Build and upload both the firmware and the LittleFS web filesystem over USB:

```bash
pnpm device:upload --config config/tap-1.json
```

For a web-only iteration, rebuild and upload only the LittleFS filesystem:

```bash
pnpm device:upload:fs --config config/tap-1.json
```

Add `--ota` to either upload command to upload over Wi-Fi to the profile's
address instead of USB. `device:upload --ota` uploads the firmware, waits for the
device to restart and rejoin Wi-Fi, then uploads the filesystem:

```bash
pnpm device:upload --config config/tap-1.json --ota
```

The first firmware with over-the-air updates goes on over USB.

Uploads keep the saved Wi-Fi network, the screen image and the device log, which
live outside the web filesystem.

Use `device:upload` whenever the profile or firmware changes. A filesystem-only
upload can create mismatched web and firmware identities if it uses a different
profile from the firmware already on the device.

The same profile can be selected through the environment:

```bash
DEVICE_CONFIG=config/tap-2.json pnpm device:build
DEVICE_CONFIG=config/tap-2.json pnpm device:upload
```

Profile paths are resolved relative to the repository root. Each device command
prints the selected config, brand, device, access-point name, and hostname before
building. The combined commands then:

1. Build the web app with the selected profile.
2. Copy the web output into the ESP32 filesystem image.
3. Generate firmware constants from the same profile and `config/secrets.json`.
4. Build or upload the requested device artifacts.
