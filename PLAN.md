# Keg level display plan

Status: steps 0 to 5 done, step 6 (beer library) in progress (6a of 4 parts done). Last updated 2026-11-10.

## Goal

Each tap's display shows its beer image plus how full the keg is, read over Bluetooth
from a KegLand RAPT Laser Level Sensor in the keg lid. The displays are now always on
(USB power), so the battery, power-switch and deep sleep design goes.

## Hardware

- 3 taps, each with a Seeed Studio XIAO ESP32-S3 and a 4-inch Spectra 6 (400 x 600)
  e-paper panel, in a 3D-printed enclosure on top of the font, powered from one USB
  splitter. One tap exists today; the other two are on order.
- 3 RAPT Laser Level Sensors (Cornelius keg lid kits), all on 19 L corny kegs, labelled
  with 1-3 dots. Kegs move between positions (back left, back right, centre front) and
  taps, so the laser each tap shows is chosen in its web app and changes over time.
  Addresses (as registered in the RAPT app):

  | Laser | Address |
  | --- | --- |
  | 1 | `E5:4C:66:F9:E1:33` |
  | 2 | `C4:A3:DF:A2:C5:1B` |
  | 3 | `D9:EB:DE:7E:BE:48` |
- Signal at the font with a sensor inside the kegerator: about -80 to -90 dBm,
  measured with a phone.

## Sensor broadcast

Readings are in the sensor's Bluetooth broadcasts, so the ESP32 never connects. It
does have to ask for them, though: the advertisement itself holds only the service
UUID, and the reading is in the scan response, which the sensor sends only to a
scanner that requests it (active scanning). Phones, nRF Connect and the laptop do this
by default and show both merged, which hid it until step 3. Passive scanning on the
ESP32 heard a Smart Mode laser a few times an hour at best (more in Session Mode);
active scanning hears each one about 36 times a minute.

- **Smart Mode (1, default):** advertises constantly (up to 12 times a minute heard).
  It measures regularly but only updates the reading it broadcasts when the level
  changes: a 1 cm lift was reported in about 2 minutes, while a steady level kept the
  same reading, byte for byte, for an hour. The RAPT app can connect and force a
  reading. KegLand quotes 18+ months on 3 AAA batteries (5-minute intervals), but
  their Pill drains much faster than quoted, so watch the real battery drain.
- **Session Mode (2):** entered by itself when the level changes, with a new reading
  about every 35 seconds, then back to the previous mode a few minutes after the
  level settles.
- **Live Stream Mode (3):** a fresh reading about every second. Started or stopped by
  holding the sensor's Bluetooth button for about 2s (or from the app, with a Pro
  subscription), and ends by itself. Useful for development and filling kegs; drains
  the battery.
- **Ultra Low Power Mode (4):** wakes on a 30-minute-7-second grid. After a level
  change it reports in most slots for a few hours (the first report 16-52 minutes
  after the change), then goes silent while the level stays steady (10+ hours seen).
  Each broadcast lasts 2-5 seconds, so a phone scan rarely sees it. The RAPT docs say
  it must first be "bonded" to a RAPT device, but the broadcasts are normal and
  readable without that. The only way out is double-tapping the sensor's Bluetooth
  button. KegLand quotes several years of battery.

Sensor buttons ([RAPT docs](https://docs.rapt.io/equipment/rapt-laser-level-sensor/operation)):
a single press of Bluetooth takes a reading and broadcasts it; a double tap toggles
Smart and Ultra Low Power; holding it for about 2s toggles Live Stream. A single press
of Power shows the mode as 1-4 green blinks.

The advertisement (a connectable `ADV_IND`) contains flags (`0x06`) and the 128-bit
service UUID `52415054-0a06-9215-08bf-f2b018840000` ("RAPT"). The scan response
contains manufacturer data with company ID `0x4152` ("RA") followed by a 19-byte
payload. Multi-byte values are little-endian.

| Offset | Size | Field | Notes |
| --- | --- | --- | --- |
| 0 | 2 | `50 54` ("PT") | Signature, confirmed |
| 2 | 1 | `A1` | Format or device type |
| 3 | 6 | Sensor address | Matches the address in the RAPT web app, confirmed |
| 9 | 2 | Laser distance, mm | 0 when there is no reading |
| 11 | 2 | Liquid height, mm | Vessel height set in the RAPT app minus distance; not used |
| 13 | 1 | Unknown (10) | Not used |
| 14 | 2 | Battery, 0.1 % | Confirmed: 849 with old batteries, app showed 84% (rounds down). Sags while the laser fires (78.5-85.9% within a minute in Live Stream). `FFFF` = no value |
| 16 | 2 | Temperature, 0.01 °C, signed | Moves in 0.25 °C steps. `0x8000` = no value |
| 18 | 1 | Mode | Confirmed: 1 Smart, 2 Session, 3 Live Stream, 4 Ultra Low Power (matches the mode LED blinks) |

Distance plus liquid height is always 560 in the broadcasts. The broadcast distance and
the RAPT app's distance come from separate measurements and have differed by 3-9 mm.
That is ignored; the ESP32 uses the broadcast value, and readings jitter anyway.

Some advertisements are empty (no reading, like the second capture below), for example
while the RAPT app is connected or just after it forces a reading. The ESP32 ignores
them. To capture one with data: close the RAPT app, press the sensor's button, wait
10-15 s, then copy the data.

### Captures

Payloads after the company ID, for decoder tests:

| Payload | Decoded |
| --- | --- |
| `5054A1E54C66F9E13313001D020AE803B70703` | Distance 19 mm, height 541 mm, battery 1000, 19.75 °C |
| `5054A1E54C66F9E1330000000000FFFF008001` | No reading (all values empty) |
| `5054A1E54C66F9E1338500AB010AE8031B0801` | Distance 133 mm, height 427 mm, battery 1000, 20.75 °C. Ruler and RAPT app: 136 mm, 14.9 L |
| `5054A1E54C66F9E1337001C0000A5103850701` | Distance 368 mm, height 192 mm, battery 849, 19.25 °C. Old batteries. RAPT app: 359 mm, 6.9 L, battery 84% |
| `5054A1E54C66F9E133C1006F010A5703210702` | Distance 193 mm, height 367 mm, battery 855, 18.25 °C, Session Mode. Laptop log, 2026-11-02 |
| `5054A1E54C66F9E133E90047010AFF02530703` | Distance 233 mm, height 327 mm, battery 767 (sagging while the laser fires), 18.75 °C, Live Stream. Laptop log, 2026-11-02 |
| `5054A1E54C66F9E133DB0055010A5B039E0704` | Distance 219 mm, height 341 mm, battery 859, 19.50 °C, Ultra Low Power. Laptop log |

Advertisement and scan response for the 136 mm capture, merged as nRF Connect shows
them (the advertisement ends after `...54504152`):
`0x020106110700008418B0F2BF081592060A5450415216FF52415054A1E54C66F9E1338500AB010AE8031B0801`

### Litres and percentage

```text
litres     = capacity x (emptyDistance - distance) / (emptyDistance - fullDistance)
             clamped to 0..capacity, shown rounded down to 0.1 L
percentage = floor(litres / capacity x 100)
```

Constants: capacity 19 L, `emptyDistance` 552 mm and `fullDistance` 22 mm (about
27.9 mm per litre), rounding down like the RAPT app. This matches every app reading so
far. The first guess, from the app's custom 19 L vessel (563 mm and 17 mm), gave 7.0 L
at 359 mm instead of 6.9 L. Keep the constants in one place so they can be updated
from real kegs at the next keg change.

| App distance | App volume | 552/22, rounded down |
| --- | --- | --- |
| About 17 mm | 19 L | 19.18, capped at 19 |
| 133 mm | 15.0 L | 15.02 -> 15.0 |
| 134 mm | 14.9 L | 14.98 -> 14.9 |
| 135 mm | 14.9 L | 14.94 -> 14.9 |
| 136 mm | 14.9 L | 14.91 -> 14.9 |
| 250 mm | 10.8 L | 10.82 -> 10.8 |
| 359 mm | 6.9 L | 6.91 -> 6.9 |

## Display

- **Top 400 x 400:** the uploaded image.
- **Bottom 400 x 200 strip,** drawn by the ESP32:
  - Top row, 40px bold: the percentage on the left (`87%`), read first because the
    strip is about the keg's level, the temperature on the right (`2.6°`), and the
    laser dots, battery icon and mode icon in the middle. The middle group is centred
    on the screen, so the icons line up across the taps.
  - Below: a 368 x 96 bar with a black outline. Fill is green from 100% to 50%,
    orange from 49% to 25% and red at 24% and below. The screen has no orange, so
    orange is a fixed pattern of 2 red pixels to 1 yellow, the mix the web app's
    encoder makes of `#FF5500`, which looked most orange on the real screen. The litres
    (`16.5L`, 64px bold) are centred in the bar. Each pixel of the text is white over
    the green or red fill and black over orange and the empty part, so a character the
    fill's edge crosses is split in two colours.
  - Battery icon: black outline, always shown. At 10% or more it has a green fill in
    10% steps and no number. Below 10% the outline turns red, with a red fill and the
    percentage inside (`7%`), both in 1% steps.
  - Laser dots: 1-3 filled dots matching the label on the laser's lid, so it is clear
    which laser the tap is showing. Stacked vertically to the left of the battery, so
    the group is the same width on every tap.
  - Mode icon, always shown next to the battery icon: a simple outline brain for
    Smart or leaf for Eco (Ultra Low Power), matching the mode chosen for this tap.
    The brain is recognisable at 32px on the real screen.
  - Text in Roboto, the web app's font. The firmware holds just the characters the
    strip needs, at the sizes it uses, and the web preview uses the same font.
  - Mode warning: a warning sign (yellow inside, with a black outline and "!") next
    to the mode icon once the laser has been in the other mode for over an hour. Session Mode and Live Stream never count.
    Double-tapping the laser's Bluetooth button switches between the two. A battery
    change or restart puts the laser back in Smart Mode.
- **Special states:**
  - No laser chosen: the strip shows "No laser".
  - Nothing heard from the laser: keep showing the last values. With Smart chosen,
    the laser broadcasts constantly, so silence for over 10 minutes (set in step 3)
    is a real problem: show a no signal icon (a blue Bluetooth symbol crossed out in
    red) next to the battery icon. It replaces the mode warning, as the laser's mode
    isn't known while it's silent. One redraw when it appears, one when it clears. With Eco
    chosen, a steady keg is silent for 10+ hours, so there is no warning. Either way,
    flat batteries, the likely failure, show as the red battery icon first. No "last
    updated" time on screen: it would be frozen at the last redraw. The web app's
    Status dialog shows "last heard" live.
  - Temperature or battery missing from an advertisement: keep the last known value.
  - No saved image: show setup help instead. Before Wi-Fi is set up, that is the
    access point name and password; once connected, it is
    `http://<hostname>-<deviceId>.local`. Setup help never replaces a saved image, for
    example after a power cut.

## Redraw rules

The panel can only redraw the whole screen, which flashes, so it redraws only when
something shown changes.

| Value | Rule |
| --- | --- |
| Level | 1% steps, rounded down. Only goes down, and a drop redraws as soon as the laser reports it, so a pour shows straight away. If the laser measured mid-pour, its next reading (about 35s later in Session Mode) redraws again with the final level; a redraw can't be cut short, as stopping the panel part-way can leave lasting ghosting. A rise of 5 points or more is a refill, shown once the level has stayed within 1 point for 1 minute, as a keg change involves a lot of moving; it then shows the lowest reading in that minute. Within 1 point, as a reading on the line between two percentages flickers between them. Smaller rises never show. |
| Battery | Use the highest reading from the last hour, to ignore sags while the laser fires. That value only goes down; a large rise (new batteries) shows immediately. |
| Temperature | Updated whenever the screen redraws. On its own, it triggers a redraw only if it has moved 0.5° or more and the last redraw was at least an hour ago. |

Every redraw shows the latest of everything, so a pour's redraw also brings the temperature up to date. A battery or temperature redraw waits while a rise might still become a refill (up to a minute), so they come together.

Force refresh in the settings menu still redraws on demand.

## Firmware changes

- **Always on:** remove deep sleep.
- **Wi-Fi:** with saved Wi-Fi, retry every 30s and never give up. After 5 minutes
  without Wi-Fi, also open the setup access point while still retrying. Pause retries
  while a phone is connected to the access point, and close it once Wi-Fi connects.
  Sensor readings and display updates keep working without Wi-Fi.
- **Storage:** keep Wi-Fi and sensor settings in the ESP32's settings storage (NVS),
  and the screen image, log and beer library in one data partition (`store`, 3.9 MB),
  so `device:upload` and `device:upload:fs` erase neither. One data partition rather
  than one each, because LittleFS already handles flash wear and safe replacement;
  the code caps the log and library sizes. Changing the partition table needs one
  full erase, so step 2 sets every partition at once (see `esp32/partitions.csv`):
  two firmware slots of 1.75 MB (down from 3.2 MB; a test build with Bluetooth
  scanning and OTA was 1.06 MB), 512 KB for the web app files, and the data
  partition. Done in step 2a.
- **Device log:** a rolling log capped at 1 MB in the data partition, so uploads and
  firmware updates keep it, for checking what happened later (and feeding it to
  Claude). It records events, not every advertisement: each new reading (time,
  distance, mode, battery, temperature, signal strength), a count of advertisements
  heard every 5 minutes, redraws and why, Wi-Fi drops (with the reason), reboots
  (with the reason) and mode warnings. About 25 KB a day, so roughly 6 weeks, oldest
  dropped first. Entries are held in memory and written every few minutes to spare
  the flash, so a power cut loses at most those minutes. Times come from the
  internet (NTP), or time since boot until Wi-Fi connects. Done in step 2b, with
  boots, Wi-Fi, the setup access point, uploads and redraws; the sensor entries come
  in step 3.
- **Beer library:** up to 30 beers per tap in the data partition, so uploads and
  firmware updates keep them. Each is the cropped 400 x 400 picture as a JPEG of at
  most 70 KB, plus a thumbnail of at most 16 KB and when it was last shown on a tap.
  The web app does all the image work; the firmware only stores, lists and deletes
  them. A beer's ID is its JPEG's CRC-32, so a copy sent on from another tap keeps
  its ID and the grid shows it once (the screen image's checksum, first planned,
  would change when another tap re-dithers the picture). Sending a beer a tap has
  only marks it shown now. Pages on the local network, such as other taps', can
  read and delete them: CORS answers only `.local` names, localhost and private
  addresses. Done in 6a (`esp32/src/LibraryManager.cpp`, rules in
  `esp32/lib/BeerLibrary` with laptop tests), tested on tap 1:
  - `GET /library` lists the beers, last shown first; `GET /library/<id>.jpg` and
    `<id>.thumb.jpg` serve the files, cached by browsers for good; `POST /library`
    takes `image.jpg` and `thumbnail.jpg`, answering 409 when full;
    `POST /library/remove` takes up to 10 IDs.
  - LittleFS is slow with many files in a folder (listing 28 beers by opening their
    files took 3.9s), so the tap keeps the list in memory, with the times in one
    index file, and reads only file names at boot. Listing takes 20ms and a file
    about 0.09s; removing one takes about 0.2s.
  - The web server's task restarts the tap if one request holds it for 5s, which
    is why removals come at most 10 at a time (about 2s).
  - One upload at a time; a second waits with "try again". A cut-off upload is
    cleaned up, and boot removes any leftover files.
  - `/status` gives the library's count. The Status dialog shows it, and factory
    reset has "Also clear this tap's beer library".
- **Factory reset** replaces Forget Wi-Fi. It clears Wi-Fi, sensor and image, then
  reboots into setup. It keeps the log and the beer library unless asked to clear
  them too. Done in step 2b, apart from the sensor (step 4) and library (6a).
  The screen keeps the last picture until the setup help screen arrives in step 7.
- **Lasers:** a shared list, `config/lasers.json` (laser number and address), is
  built into every tap. Each tap stores which laser it shows and which mode it
  expects (Smart by default). RAPT sensors not in the list can still be chosen by
  address. Changing laser resets the shown values straight away. Nothing stops two
  taps showing the same laser; the dots make it visible. Once a laser is chosen, the
  tap asks only that one for readings (the Bluetooth accept list), so each laser
  answers one tap. Each request for the laser list (`GET /lasers`) asks every laser
  for the next minute, so the picker shows them all live while it's open.
- **Over-the-air updates:** `ArduinoOTA` with a password. The new partition table keeps
  two firmware slots, and `pnpm device:upload --ota` uploads over Wi-Fi to the
  profile's address using PlatformIO's `espota` protocol. The first OTA-capable
  firmware goes on over USB. Done in step 2c: firmware and web app in about 35 s,
  with each update (and a wrong password) in the device log.
- **Hostnames:** the build scripts and web app use the real
  `<hostname>-<deviceId>.local` address, with one profile per tap in `config/`
  (`tap-1.json` to `tap-3.json`, and `example.json`). Device commands require
  `--config`. Done in step 2c.
- **Passwords:** the repository is public, so the setup access point and OTA
  passwords live in a git-ignored `config/secrets.json`, read only by the firmware
  build. They no longer appear in the web app, and the firmware only keeps the OTA
  password's hash. Done in step 2c.
- **Status dialog:** add the sensor address, chosen and actual mode, last reading,
  signal strength and time since the last reading.
- **Screen image and strip (step 5a):** the stored image becomes 400 x 400 (80,000
  bytes), drawn above the strip, which the firmware draws itself. Until step 5b,
  uploads of a full 400 x 600 screen (120,000 bytes) were still accepted and only
  the top 400 rows kept; part 1 of 5b removed this. Tap 1's old 400 x 600 test image
  was deleted once at boot; taps 2 and 3 never had one.
- **Test values:** a route sets the strip's percentage, temperature and battery for
  "Show on device". The tap shows them for 5 minutes, or until "Back to live", then
  goes back to its real readings, so a tap is never left showing made-up numbers.
  `POST /strip/test` takes percent, temperature, battery and optionally litres
  (otherwise worked out from percent for a 19 L keg), modeWarning and noSignal
  ("true"); `POST /strip/live` goes back early; `/status` gives
  `strip.testSecondsLeft`. Test values have a 5px red border inside the strip's edge,
  clear of the content. They're never saved, so a restart comes back live. Done in
  step 5a; litres added in part 4 of 5b.

## Web app changes

- The image area is 400 x 400. Image mode takes an image of any size and zooms it
  into the square. Fit (the whole image, with a background in the gaps) and Fill
  (covering the square) are buttons, and a Zoom slider goes between them and on to 3
  times Fill. The slider moves on a log scale, has marks at Fit and Fill, and snaps to
  them within 3%. Where the image is bigger than the square, dragging it chooses which
  part shows; zooming keeps the same point in the middle. A new image starts at Fit,
  or at Fill if the last one was at Fill. Text mode renders at 400 x 400. Uploads are
  80,000 bytes. Done in parts 2 and 3 of 5b, tested on tap 1.
  Ways to give it an image:
  - Browse for a file, or drop one on the image, as before.
  - One field, "Paste an image or its address", beside Browse. Pasting an image's
    address loads it straight away (on a laptop: right-click the image, Copy Image
    Address), and so does typing one and pressing Enter. Pasting a picture (Copy
    Image, or a screenshot) loads it too. The field then shows the file's name, the
    address, or "Pasted image".
  - Ctrl+V anywhere on the page in image mode, outside a text field, does the same,
    and an image dragged from another tab can be dropped on the image.
  - A failed address keeps the current image and says why: the site doesn't let
    other pages read its images, the address is a page rather than an image, or the
    status the site answered with.
  - A picture copied on a phone pastes too: checked with Chrome on Android, on
    tap 1.

  The Background tool, shown whenever the image leaves gaps (below Fill). Text mode
  uses the same tool for its background, without Blurred image, and each mode keeps
  its own settings:
  - Solid colour, the default, starting on white in both modes, which suits
    KegLand's product shots. A gradient's end colour starts on black.
  - Linear gradient (top to bottom) or Radial gradient (out from the middle), from a
    start colour to an end colour, with a button to swap them.
  - Blurred image: the same image filling the square, heavily blurred, behind it.

  Each colour has the screen's 6 colours as swatches, white first, as they come out
  clean while other colours are dithered. Its eyedropper button opens desktop
  Chrome's own eyedropper, which picks from anywhere on screen. In browsers without
  it, the button turns on picking from the image: the next click on the image takes
  that colour, and Escape or the button stops it. Text mode's text colour uses the
  same colour picker, and text mode starts as black text on white.

  KegLand's images (Shopify) let other pages read them, but their product pages
  don't. Pasting a product page link, or an image from a site that blocks it, would
  need the ESP32 to fetch it instead; left for later.
- Beer library, for beers made again (image mode only; text mode is a last resort):
  - Sending a beer also saves it to this tap's library unless it is already there.
    Each tap keeps a copy of every beer it has shown, so a dead tap loses nothing.
  - A Library button opens one grid of thumbnails from all three taps, each beer
    once, sorted by when it was last on a tap, with that date under it (for example
    "last on tap 2, Mar 2026"), and this tap's count (for example "27 of 30").
    Picking a beer loads it into the preview, the same as choosing a file.
  - Select several thumbnails, then "Remove 3" deletes them from every tap.
  - When this tap is full, Send opens the same grid to choose what to remove, or
    "Send without saving". Nothing is ever removed automatically, because the oldest
    beers may be the ones made most often.
  - Two keg states always in the grid, which can't be removed: "Keg empty" and "Keg
    ready" (cleaned and ready to fill). Sending one adds the date, for example "Keg
    ready · 9 Nov", as a reminder of when the keg was emptied or cleaned. The strip
    still shows the laser's reading. Nothing switches to them automatically.
- The preview shows the whole screen, including a close copy of the strip with the
  tap's live readings and the chosen mode's icon. Until something new is composed,
  it shows the tap's stored image (`GET /image`, labelled "On the tap"), so the page
  opens on what the screen shows; Reset goes back to it. Added in part 4 of 5b.
- Developer mode, a switch in Settings (off by default, remembered by each browser;
  each tap's page is its own site to the browser, so each tap remembers it
  separately), adds Test values under the preview: percentage (slider and number
  input) and litres, temperature, battery, and the Mode warning and No signal icons.
  The percentage and litres are linked: a percentage gives the litres the tap works
  out for it, and typed litres give the percentage a real reading would show with
  them (11.8 L gives 62%, a pair no percentage alone makes). The
  preview shows them, with the red border, and "Show on device" sends them to the
  tap to check the strip on the real screen (see Test values above). While the tap
  shows test values, a countdown and "Back to live" show under the preview, with or
  without developer mode. The tap takes a request between redraws, so for a minute
  after one the page trusts the request until the tap's answers show it. Done in
  part 4 of 5b, tested on tap 1.
- Roboto is built into both pages rather than loaded from Google Fonts, so the setup
  page (whose phone has no internet) and text mode always have it: one variable font
  file trimmed to weights 400-700 and to ASCII, Latin-1 and common punctuation,
  about 25 KB a page (Google's file is 43 KB). The unused 800 weight is dropped.
  Done in part 5 of 5b: `pnpm roboto:subset` makes `web/src/fonts/roboto.woff2`
  (26 KB, keeping the font's copyright and license entries), and each gzipped page
  grows by about 28 KB. The build now puts every file inside its page and fails if
  anything is left over. Text mode waits for its font before drawing, as the canvas
  wouldn't redraw when it arrived. Checked with Google's font servers blocked: both
  pages on the laptop, and the app page on tap 1, load nothing from outside and draw
  in Roboto.
  Each page also declares a blank icon, as browsers asked for /favicon.ico and the
  tap answered with the whole page again, a second download on every load.
- A laser picker next to Send, and on the setup page below the Wi-Fi settings, as
  it's optional there and can be changed later in the app. It lists every laser in
  the shared list with its dots and, when heard recently, its reading, mode and when
  it was last heard; a laser in Eco may not be heard yet, so check the dots on its
  lid. A Save button sends the choice, and it can be skipped. On the setup page the
  laser and Wi-Fi are one form: its Save sends the laser first (kept whether or not
  Wi-Fi connects), then joins Wi-Fi. Both pages show which tap it is in a large
  badge (for example "Tap 1"), and so does the browser tab's title. The picker also
  sets the mode this tap expects:
  - Smart (default): screen a few minutes behind a pour, RAPT app works, batteries
    changed more often.
  - Eco (Ultra Low Power): batteries last longer, screen up to about an hour behind.

  A laser in the other mode says how to fix it: "double-tap its Bluetooth button".
- Tap switcher: a large tap badge in the header (for example "Tap 2") and a dropdown
  linking to the other taps' pages, built from the profiles in `config/`. Done in part
  6 of 5b: the build lists every profile next to the tap's own with the same brand and
  hostname (never reading the secrets file), and links to each tap's `.local` address.
  With one tap it's a plain badge, and the setup page keeps its plain badge.
- Settings: Status, Force refresh, Download log (a CSV file), Reboot and Factory
  reset.
- Factory reset asks first, in a dialog like the old Forget Wi-Fi one. It says what
  will be cleared (Wi-Fi, laser and screen image) and that the device restarts in
  setup, with two checkboxes, unticked by default:
  - Also clear the log. Done in step 2b, with Download log.
  - Also clear this tap's beer library. Copies on other taps stay, so those beers
    still show in the library. Done in 6a.

## Steps

Each step ends with something visible to check.

0. **Capture advertisements.** Done, including the Ultra Low Power and Smart Mode
   logs.
1. **TypeScript decoder:** a new workspace package that parses advertisements and
   converts distance to litres and percentage, tested with the captures above.
   Optionally, a Node script that prints live readings from the laptop's Bluetooth.
2. **Always-on housekeeping:** deep sleep, Wi-Fi retry, settings storage, the new
   partition table (including the library's space), the device log and Download log,
   factory reset, over-the-air updates and the hostname fix. Test by turning the
   router off for 10 minutes, doing a filesystem upload, running a factory reset, and
   uploading over Wi-Fi, then checking the downloaded log shows all of it. Done, in
   three parts (2a, 2b, 2c), tested on tap 1.
3. **ESP32 listens:** active Bluetooth scanning, with a C++ decoder tested on the
   laptop against the same captures. Readings, signal strength and missed readings
   show in the serial log, the device log and the Status dialog. Done, tested on
   tap 1.
4. **Lasers,** in two parts:
   - 4a, firmware: the shared laser list (`config/lasers.json`), the chosen laser and
     mode in settings, asking only that laser except while the picker searches,
     `GET /lasers` and `POST /laser`, and factory reset clearing the choice.
   - 4b, web app: the picker (with the mode choice) next to Send and on the setup
     page, the tap badge and title on both pages, and Status marking the chosen
     laser.

   The dots and mode icon on screen moved to step 5, which draws the strip. Done,
   both parts tested on tap 1, including the setup page after a factory reset.
5. **New layout,** in two parts:
   - 5a, firmware: the 400 x 400 image, the strip drawn in Roboto (with the laser dots
     and mode icon), the redraw rules (with the mode warning and no signal icon), the
     strip's values kept over a restart, and the test values route, tuned on tap 1's
     real screen. Done, tested on tap 1 with real pours, a refill and a power cut.
   - 5b, web app, in 6 parts: (1) the 400 x 400 image area and the full-screen
     preview with the strip; (2) zoom between Fit and Fill, with the Background for
     the gaps; (3) pasting an image address or an image; (4) developer mode with
     "Show on device"; (5) Roboto built into both pages; (6) the tap switcher. All 6
     done, tested on tap 1.
6. **Beer library:** storage on each tap, the shared grid, removing several at once,
   the prompt when full and the keg states. Test by sending a beer on one tap and
   picking it on another. In four parts: (6a) the firmware's storage and routes, with
   the factory reset option; (6b) saving on Send and the Library grid from all taps;
   (6c) removing several and the prompt when full; (6d) the keg states. 6a done,
   tested on tap 1.
7. **Setup help screen.** The redraw rules and the strip's special states, first
   planned here, were done in step 5a.
8. **Fit the enclosure,** once the case parts are printed and the last screens arrive.
   The case's frame may cover a few pixels of each screen, and more on one side
   than the other. Each tap gets its own visible area (how much each edge loses),
   set in the web app with "Show on device" to check it: the strip centres in the
   visible area, the test values' red border moves in with it, and the preview
   shades what the frame hides, so images can be framed to match. The screen won't
   move once it's screwed in, so a factory reset keeps it: it's saved in the tap's
   settings (NVS), which updates and uploads don't touch, and the factory reset
   leaves it out (its dialog says so). Tuning needs no flashing: the saved fit takes
   effect straight away. Once it looks right, `pnpm device:save-fit --config
   config/tap-1.json` reads the tap's fit over Wi-Fi and writes it into that tap's
   profile, to commit. The firmware uses the profile's fit only when the saved one
   is missing, such as after erasing the whole chip or swapping in a new ESP32
   behind the same screen.
9. **Wrap up,** the last commits on `keg-level` before merging into master: move the
   lasting facts into docs (the sensor details into `docs/rapt-laser-sensor.md`, how
   the display behaves into the READMEs), then move this plan to
   `docs/plans/2026-11-keg-level.md` with a line at the top saying it is done and
   when it was merged. After that the archived plan is never edited; fixes go in the
   docs. Ideas still marked Later stay listed there, and each gets its own new plan
   file when picked up.
10. **Later:** RAPT cloud upload.

## Open questions and later ideas

- **The phone can't open the tap's page (2026-11-10), fixed:** on ChromeQ
  (192.168.0.72), the phone got "This site can't be reached" for the tap and even the
  router (192.168.0.1), while the laptop reached them all. On the phone's hotspot it
  failed the same way by address, with ERR_TOO_MANY_RETRIES. The cause was Android
  17's local network permission, which Settings calls Nearby devices: Chrome had it,
  but it wasn't in effect (Settings warned it was set for an older Android version).
  Turning it off and on again fixed it. The phone that hosts the hotspot can't look up
  the taps' `.local` names, so it uses the tap's address there. Still to check at home:
  the phone on ChromeQ reaching a tap on ChromeQ_2.4 (the same router's 2.4 GHz
  band), by name and by address.

- **Smart or Eco, a per-tap choice (2026-11-02):** default Smart, because the screen
  stays a few minutes behind a pour and a silent sensor can be flagged. Eco (Ultra
  Low Power) is there if Smart's battery drain turns out too high, at the cost of the
  screen being up to about an hour behind. Whether Eco reports a single 500 ml pour
  (about 14 mm) is untested; step 3's logs will show it. Laser 1 was logged with a
  laptop; each Ultra Low Power broadcast lasts 2-5 seconds (3-14 advertisements
  caught):
  - Switched to Ultra Low Power at 20:16:31; 20:46 and 21:16 skipped.
  - 21:46:36 to 02:17:38: every slot, 10 readings. The first reported a 9 cm lift
    made at about 21:30 (like pouring 3 L at once), 16 minutes late.
  - 02:17:38 to 10:43: nothing heard for 8.5 hours, until a button press. Unproven:
    the laptop was later found not scanning (see below), so it may have missed these.
  - Lifted about 25 mm at 10:51 and 12 mm at about 11:26 (two "pints"). First report
    at 11:43:36, 52 minutes after the first lift. Then 12:43, 13:13, 13:43, 14:14,
    15:14 and 15:44. Skipped 11:13 (after the level had changed), 12:13 and 14:44,
    while the laptop was clearly listening.
  - Nothing heard 16:14-17:44 because the laptop's Bluetooth was restarted (to fix a
    mouse), which stopped scanning. The logger now records scanning changes and
    restarts it.
  - For comparison, Smart Mode (2026-11-01 evening): lowering the sensor 3 cm started
    Session Mode, with a new reading about every 35 seconds for 5 minutes. It then
    switched to Smart Mode by itself at 18:20:37 and advertised constantly (up to 12
    times a minute), but with the same reading, byte for byte, until it was switched
    back at 19:27, an hour later. (The next evening showed why: it only updates the
    reading when the level changes.)
  - Switched back to Ultra Low Power at 19:27:05 with no level change, then nothing
    at all until at least 05:56 the next morning (10.5 hours), with the laptop
    scanning the whole time. So the sensor mostly reports after the level changes
    (a few hours of half-hourly readings, then quiet) and stays silent while the
    level is steady. No check-in seen within 10.5 hours.
  - Smart Mode, 2026-11-02 evening (3 hours logged): removing a block as it was
    switched to Smart started Session Mode at 18:28:21, a new reading about every 35
    seconds for 4 minutes, then back to Smart at 18:36. Idle, the reading stayed the
    same for an hour. A lift at about 19:39 was reported at 19:41:07, in Session
    Mode, which went back to Smart at 19:55 (with Live Stream from 19:45 to 19:48, not
    started on purpose). Putting the block back (232 to 209 mm) was reported at
    20:45:38, back to Smart at 20:52.
    Session readings jitter by 1-3 mm. The longest gap between advertisements heard
    was 88 seconds, so the 15-minute no signal limit has plenty of margin. In
    Session and Live Stream the battery read as low as 76.7%, against 85.2-85.6% in
    Smart, so the highest-in-an-hour battery rule is needed. Smart readings went from
    85.6% to 85.2% over the 3 hours, too short to judge the drain.
  The RAPT docs say a bonded receiver "detects a volume change", but the same page
  calls the sensor the "Screen Board" elsewhere, so the sensor most likely starts
  Session Mode by itself. Bonding would bring nothing the broadcasts don't already
  give. Step 3 must check the ESP32's catch rate, because it shares one radio between
  Wi-Fi and Bluetooth.
- **Step 3 catch rate (2026-11-07):** with passive scanning, tap 1 heard no lasers
  for nearly 2 hours while the laptop heard all three; a raw dump showed every Smart
  Mode advertisement held only the service UUID. Switched to active scanning, the tap
  heard each laser 176-189 times in 5 minutes, with a longest gap of 14 s, while its
  setup access point was open. Over 3 hours on home Wi-Fi the longest gap was 15s,
  apart from 9 minutes while the RAPT app was connected to laser 1, which stops its
  broadcasts. So the no signal limit is 10 minutes: a dead laser shows soon, and a
  few minutes in the RAPT app doesn't trigger it. Open: whether answering scan
  requests from three taps shortens battery life. Step 4 can have each tap ask only
  its own laser (the Bluetooth accept list), so each laser answers one tap.
- **Step 3 lift test (2026-11-07, laser 1):** the tap saw a 16 mm lift and the
  return within seconds, each as Session Mode, and Smart came back about 9 minutes
  after the level settled. While the RAPT app was connected, laser 1 broadcast
  nothing at all. Soon after the app was closed, it went from Session into Live
  Stream for 3.5 minutes with no button pressed, perhaps left over from the app's
  connection.
- **Calibration:** measure an empty keg filled from a graduated jug. Note the
  broadcast distance and the RAPT app's litres when empty, then after each fill, in
  1 L steps near the bottom and top and larger ones in between. Near full the
  straight line is off: on 2026-11-07 the RAPT app showed laser 1 at 83 mm with
  15.8 L remaining (Diagnostics), where the formula gives 16.8 L, though the app
  readings at 133-359 mm fit it exactly. The app has 0.9 L between 83 and 133 mm
  where the straight line has 1.8 L, which fits the keg's domed top holding less
  per mm (the bottom is domed too). If so, the litres come from a table of measured
  points, interpolated between them, instead of one straight line.
  The distance is measured from about where the laser rests, the underside of the
  lid, not the bottom of its housing: each laser read 84-89 mm on its 85 mm delivery
  box, with the bottom of the housing about 70 mm above the table. So the housing
  hangs about 15 mm below the lid, and a full keg can't read much less than that.
  Every reading has the same offset, so the constants already include it.
- **Signal margin:** watch signal strength in step 3 and move the antenna if readings
  are missed.
- **RAPT cloud:** the public API has no level device type. External Devices (paid
  subscription, one reading per 15 minutes) only accepts temperature, gravity,
  pressure, signal strength and battery, so the level would have to go in a spare
  field. Decide later.