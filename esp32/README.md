# DavBar Keg Display Firmware

This PlatformIO project contains the Arduino firmware for a Seeed Studio XIAO ESP32-S3 connected to a 4-inch Spectra 6 e-paper display.

The device is powered over USB and always on. At startup, the firmware mounts its
two filesystems and joins the saved Wi-Fi network. Once connected, it advertises
`<hostname>-<deviceId>.local` over mDNS and serves the web app.

With no saved network, it starts a setup access point. With a saved network, it
retries every 30 seconds and never gives up. After 5 minutes without Wi-Fi it also
opens the setup access point, so the network can be changed, and closes it once
Wi-Fi connects. Retries pause while a phone is connected to the access point,
because searching for the router disturbs it.

When the stored image (`/image.bin`) differs from the one last drawn, the firmware
renders it and puts the panel to sleep. A forced refresh from the web app redraws
it anyway.

## Storage

`partitions.csv` splits the 8 MB flash:

| Partition | Size | Holds |
| --- | --- | --- |
| `nvs` | 20 KB | Settings, such as the saved Wi-Fi network |
| `app0`, `app1` | 1.75 MB each | Two firmware slots, for over-the-air updates |
| `spiffs` | 512 KB | The web app, replaced by every filesystem upload |
| `store` | 3.9 MB | The screen image and the device log |
| `coredump` | 64 KB | Crash dumps |

Filesystem uploads never touch `nvs` or `store`. `store` has a custom subtype
because PlatformIO uploads the filesystem to the last `spiffs`, `fat` or `littlefs`
partition it finds.

Changing the partition table needs one full erase, which also clears the saved
Wi-Fi and image. From the repository root:

```bash
~/.platformio/penv/bin/platformio run -d esp32 --target erase
```

Then upload everything again from `../app` with `pnpm device:upload`.

## Device log

`DeviceLog` records events to the serial port and to numbered CSV segments in
`/log` on `store`: 16 segments of up to 64 KB, the oldest removed first. Entries
are held in memory and written every 5 minutes, or sooner when 4 KB build up or
before a restart. Each entry has a UTC time (empty until the clock is set from the
internet; a `clock set` entry marks the switch), the uptime in seconds, the event
and its details. The boot entry includes the reset reason and the firmware build
ID (the start of the ELF SHA-256), which tells builds apart.

`GET /log` streams the whole log as one CSV file.

The normal build and upload workflow runs from `../app`:

```bash
pnpm device:build
pnpm device:upload
```

These commands build the web filesystem and firmware with the same shared device
profile. See the [project README](../README.md) for profile fields and all commands.

Raw PlatformIO commands are intended for firmware-only development. From the
repository root, set `DEVICE_CONFIG` explicitly when using a non-default profile:

```bash
DEVICE_CONFIG=config/davbar-tap-1.json ~/.platformio/penv/bin/platformio run -d esp32
DEVICE_CONFIG=config/davbar-tap-1.json ~/.platformio/penv/bin/platformio run -d esp32 --target upload
```

Profile paths are resolved relative to the repository root. A raw firmware upload
does not rebuild or upload the LittleFS web filesystem.