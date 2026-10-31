# DavBar Keg Display Firmware

This PlatformIO project contains the Arduino firmware for a Seeed Studio XIAO ESP32-S3 connected to a 4-inch Spectra 6 e-paper display.

At startup, the firmware mounts LittleFS and connects to the saved Wi-Fi network.
If no network is saved or the connection fails, it starts a setup access point
instead. Once connected, it advertises `<hostname>-<deviceId>.local` over mDNS and
serves the web app from LittleFS.

If the stored image (`/image.bin`) differs from the one last drawn, the firmware
renders it, puts the panel to sleep, and enters ESP32 deep sleep. Otherwise it
stays awake until a new image is uploaded, which triggers the same render and
deep sleep. No wake-up source is configured, so the device sleeps until it is reset
or power-cycled. A forced refresh from the web app redraws without entering deep
sleep.

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