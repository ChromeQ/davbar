# DavBar Keg Display

DavBar Keg Display is a system for creating and showing custom 400 x 600 content on a six-colour e-paper display mounted to a keg tap. It includes tools for composing, converting, previewing, and uploading display images, plus the ESP32 firmware that renders them.

- [App and image tooling](app/README.md)
- [ESP32 firmware](esp32/README.md)

## How the device works

The device is powered over USB and always on.

1. **Wi-Fi setup.** If no Wi-Fi network is saved, the device starts a setup access
   point (`DavBar Tap 1` with the `tap-1` profile). Connecting to it opens a
   captive setup page that scans for nearby networks. The device tests the
   selected network before saving it, then reboots. If the saved network drops, the
   device retries every 30 seconds, and after 5 minutes without Wi-Fi it also opens
   the setup access point until Wi-Fi is back.
2. **Web app.** Once connected, the device serves the web app at
   `http://<hostname>-<deviceId>.local` (`http://davbar-tap1.local` with the
   `tap-1` profile). Compose text or choose a 400 x 600 image, check the Spectra 6
   preview, and send it to the device.
3. **Display.** After an upload, the device redraws the e-paper display. On
   startup, it redraws only if the stored image differs from the one it last drew.

The web app's device settings menu can show the device status, force a display
refresh, download the device log, reboot the device, or factory reset it. A
factory reset clears the saved Wi-Fi network and screen image, then reboots into
setup mode. It keeps the log unless "Also clear the log" is ticked.

The device log records events such as boots and why they happened, Wi-Fi drops
and reconnects (with the reason), the setup access point opening and closing,
uploads, and redraws (with the reason and how long they took). It holds about the
last 1 MB of entries, and survives uploads and firmware updates.

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
pnpm build     # Build the web app
pnpm preview   # Preview the production web build
pnpm lint      # Lint all workspace packages
pnpm test      # Test all workspace packages
```

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

The build derives the following values from one profile:

| Input | Used for |
| --- | --- |
| `brandName` | Web branding, page titles, default display text, and output filename |
| `deviceName` | Human-readable device name and access-point name |
| `deviceId` | Suffix of the device's mDNS hostname, so devices sharing a `hostname` stay distinct |
| `hostname` | Prefix of the device's mDNS hostname, `<hostname>-<deviceId>.local` |

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
