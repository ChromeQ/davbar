# DavBar Keg Display Firmware

This PlatformIO project contains the Arduino firmware for a Seeed Studio XIAO ESP32-S3 connected to a 4-inch Spectra 6 e-paper display.

At startup, the firmware mounts LittleFS, reads `/image.bin`, renders it to the display, and then puts the panel to sleep. Build and upload the firmware with PlatformIO; upload filesystem contents with `pio run -t uploadfs`.