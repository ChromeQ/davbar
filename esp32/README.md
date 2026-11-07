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

## Building and uploading

The normal build and upload workflow runs from `../app`:

```bash
pnpm device:build --config config/tap-1.json
pnpm device:upload --config config/tap-1.json
pnpm device:upload --config config/tap-1.json --ota
```

These commands build the web filesystem and firmware with the same shared device
profile. See the [project README](../README.md) for profile fields and all commands.

Raw PlatformIO commands are intended for firmware-only development. From the
repository root, set `DEVICE_CONFIG` to choose the tap. Without it, raw builds
(including the IDE's) use `config/example.json`, so they compile but shouldn't be
uploaded:

```bash
DEVICE_CONFIG=config/tap-1.json ~/.platformio/penv/bin/platformio run -d esp32
DEVICE_CONFIG=config/tap-1.json ~/.platformio/penv/bin/platformio run -d esp32 --target upload
```

Profile paths are resolved relative to the repository root. A raw firmware upload
does not rebuild or upload the LittleFS web filesystem. Every build needs
`config/secrets.json` (see the project README).

## Storage

`partitions.csv` splits the 8 MB flash:

| Partition | Size | Holds |
| --- | --- | --- |
| `nvs` | 20 KB | Settings, such as the saved Wi-Fi network |
| `app0`, `app1` | 1.75 MB each | Two firmware slots, for over-the-air updates |
| `spiffs` | 512 KB | The web app (two gzipped pages), replaced by every filesystem upload |
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

Then upload everything again over USB from `../app` with `pnpm device:upload`.

## Lasers

`LaserScanner` listens for RAPT Laser Level Sensor broadcasts with NimBLE, decoded by
`lib/RaptLaser`. It scans actively: a laser's advertisement holds only its service
UUID, and the reading comes in the scan response, which it sends only when asked
(see `PLAN.md`, Sensor broadcast). The radio is shared with Wi-Fi, so scanning
listens for 50ms of every 100ms, and pauses while Wi-Fi connects and during
over-the-air updates.

Each tap shows one laser, chosen in the web app (`POST /laser` with `address` and
`mode`, `smart` or `eco`) and kept in settings until a factory reset. Until one is
chosen, the tap asks every laser for readings. After that it asks only the chosen
one, using the Bluetooth controller's accept list, so each laser answers one tap.
`GET /lasers` lists every laser in `config/lasers.json`, heard or not, plus any
other RAPT laser heard, and asks every laser for the next minute, so the picker
shows them all while it's open.

The device log records a `laser reading` entry when a reading changes (at most one
every 10 seconds per laser, unless the mode changes) and a `lasers heard` summary
every 5 minutes. The summary gives each laser's broadcast count, signal range and
longest gap, the broadcasts heard from any device (none at all means Bluetooth is
getting no time on the radio; once a laser is chosen, only its broadcasts count)
and the free memory. Once a laser is chosen, the
others only appear when a search heard them. The Status dialog shows each laser's
latest reading.

## Unit tests

Code without Arduino dependencies, such as the laser decoder, is tested on the
laptop by the `native` environment. The tests in `test/test_rapt_laser` use the same
captures as the TypeScript decoder's tests in `app/rapt-laser`. From the repository
root:

```bash
~/.platformio/penv/bin/platformio test -d esp32 -e native
```

## Device log

`DeviceLog` records events to the serial port and to numbered CSV segments in
`/log` on `store`: 16 segments of up to 64 KB, the oldest removed first. Entries
are held in memory and written every 5 minutes, or sooner when 4 KB build up or
before a restart. Each entry has a UTC time, the uptime in seconds, the event and
its details. Until the internet time arrives, marked by a `clock synced` entry, the
time is empty after a power cut, or carried over and slightly off after a restart. The boot entry includes the reset reason and the firmware build
ID (the start of the ELF SHA-256), which tells builds apart.

`GET /log` streams the whole log as one CSV file.

## Over-the-air updates

Once the device has joined Wi-Fi, `ArduinoOTA` accepts firmware and filesystem
uploads at `<hostname>-<deviceId>.local`, checked against the hash of
`otaPassword`. Filesystem uploads always go to the `spiffs` partition. The device
log records each update starting, finishing or failing, and the next boot entry
shows the new firmware ID. Setting `DEVICE_OTA=1` makes `scripts/device_config.py`
switch PlatformIO's upload to `espota`, which is what `--ota` does.
