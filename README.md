# DavBar Keg Display

DavBar Keg Display is a system for creating and showing custom 400 x 600 content on a six-colour e-paper display mounted to a keg tap. It includes tools for composing, converting, previewing, and uploading display images, plus the ESP32 firmware that renders them.

- [App and image tooling](app/README.md)
- [ESP32 firmware](esp32/README.md)

## How the device works

The device is powered over USB and always on.

1. **Wi-Fi setup.** If no Wi-Fi network is saved, the device starts a setup access
   point (`DavBar Tap 1` with the default profile). Connecting to it opens a
   captive setup page that scans for nearby networks. The device tests the
   selected network before saving it, then reboots. If the saved network drops, the
   device retries every 30 seconds, and after 5 minutes without Wi-Fi it also opens
   the setup access point until Wi-Fi is back.
2. **Web app.** Once connected, the device serves the web app at
   `http://<hostname>-<deviceId>.local` (`http://davbar-tap1.local` with the
   default profile). Compose text or choose a 400 x 600 image, check the Spectra 6
   preview, and send it to the device.
3. **Display.** After an upload, the device redraws the e-paper display. On
   startup, it redraws only if the stored image differs from the one it last drew.

The web app's device settings menu can show the device status, force a display
refresh, reboot the device, or forget the saved Wi-Fi network and reboot into
setup mode.

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

Device identity and branding are defined in JSON profiles under `config`. The
fallback profile is `config/default.json`:

```json
{
	"brandName": "DavBar",
	"deviceName": "Tap 1",
	"deviceId": "tap1",
	"hostname": "davbar",
	"accessPointPassword": "davbar123"
}
```

All five properties are required non-empty strings. `hostname` must contain only
lowercase letters, numbers, and internal hyphens. `deviceId` is not validated, but
it becomes part of the device's network name, so it should follow the same rule.
`accessPointPassword` must be between 8 and 63 characters.

The build derives the following values from one profile:

| Input | Used for |
| --- | --- |
| `brandName` | Web branding, page titles, default display text, and output filename |
| `deviceName` | Human-readable device name and access-point name |
| `deviceId` | Suffix of the device's mDNS hostname, so devices sharing a `hostname` stay distinct |
| `hostname` | Prefix of the device's mDNS hostname, `<hostname>-<deviceId>.local` |
| `accessPointPassword` | Password for the device's setup access point |

For the default profile, the setup access point is `DavBar Tap 1`, the device is
reachable at `davbar-tap1.local`, and the page titles and default display text use
`DavBar`.

To rebrand a device, create another profile such as `config/krisbar-tap-1.json`:

```json
{
	"brandName": "KrisBar",
	"deviceName": "Tap 1",
	"deviceId": "tap1",
	"hostname": "krisbar",
	"accessPointPassword": "krisbar123"
}
```

## Device commands

Run device commands from `app`. Without `--config` or `DEVICE_CONFIG`, both the web
and firmware builds use `config/default.json`.

Build the web app and firmware without uploading:

```bash
pnpm device:build
```

After creating another profile, select it with `--config`:

```bash
pnpm device:build --config config/davbar-tap-2.json
```

Build and upload both the firmware and LittleFS web filesystem:

```bash
pnpm device:upload
```

Or upload a named profile:

```bash
pnpm device:upload --config config/davbar-tap-2.json
```

For a web-only iteration, rebuild and upload only the LittleFS filesystem:

```bash
pnpm device:upload:fs --config config/davbar-tap-2.json
```

Both `device:upload` and `device:upload:fs` replace the whole LittleFS filesystem,
which also erases the saved Wi-Fi credentials and display image. Afterwards, the
device starts in setup mode and needs its Wi-Fi configured again.

Use `device:upload` whenever the profile or firmware changes. A filesystem-only
upload can create mismatched web and firmware identities if it uses a different
profile from the firmware already on the device.

The same profile can be selected through the environment:

```bash
DEVICE_CONFIG=config/davbar-tap-2.json pnpm device:build
DEVICE_CONFIG=config/davbar-tap-2.json pnpm device:upload
```

Profile paths are resolved relative to the repository root. Each device command
prints the selected config, brand, device, access-point name, and hostname before
building. The combined commands then:

1. Build the web app with the selected profile.
2. Copy the web output into the ESP32 filesystem image.
3. Generate firmware constants from the same profile.
4. Build or upload the requested device artifacts.