# DavBar Keg Display

DavBar Keg Display is a system for creating and showing custom 400 x 600 content on a six-colour e-paper display mounted to a keg tap. It includes tools for composing, converting, previewing, and uploading display images, plus the ESP32 firmware that renders them.

- [App and image tooling](app/README.md)
- [ESP32 firmware](esp32/README.md)

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
lowercase letters, numbers, and internal hyphens. `accessPointPassword` must be
between 8 and 63 characters.

The build derives the following values from one profile:

| Input | Used for |
| --- | --- |
| `brandName` | Web branding, page titles, default display text, and output filename |
| `deviceName` | Human-readable device name and access-point name |
| `deviceId` | Device identity returned by the firmware status API |
| `hostname` | The `.local` hostname used when uploading display content |
| `accessPointPassword` | Password for the device's setup access point |

For the default profile, the setup access point is `DavBar Tap 1`, the upload host
is `davbar.local`, and the page titles and default display text use `DavBar`.

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