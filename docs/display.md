# The display

Each tap has a 4-inch Spectra 6 e-paper screen, 400 x 600 pixels in six colours
(black, white, yellow, red, blue and green). The firmware draws it (`esp32/lib/Strip`),
and the web app's preview draws the same pixels, so what the page shows is what the
tap shows.

## The screen

With a laser chosen, the screen is in two parts:

- **Top, 400 x 400:** the picture uploaded from the web app.
- **Bottom, 400 x 200:** the strip, which the tap draws itself from its laser's
  readings.

With no laser on purpose, the whole screen is the picture (see
[No laser on purpose](#no-laser-on-purpose)).

## The strip

- **Top row, Roboto Bold 40px:** the percentage on the left (`87%`), read first
  because the strip is about the keg's level, and the temperature on the right
  (`2.6°`). In the middle, the laser's dots, the battery and the mode icon, centred on
  the screen so the icons line up across the taps.
- **Laser dots:** 1-3 filled dots, stacked, matching the dots on the laser's lid, so
  it's clear which laser the tap shows.
- **Battery:** a black outline, always shown. At 10% or more it has a green fill in
  10% steps and no number. Below 10% the outline turns red, with a red fill and the
  percentage inside (`7%`).
- **Mode icon,** next to the battery: an outline brain for Smart, or a leaf for Eco
  (Ultra Low Power), the mode chosen for this tap.
- **Mode warning:** a warning sign (yellow, with a black outline and "!") next to the
  mode icon once the laser has been in the other mode for over an hour. Session and
  Live Stream never count. Double-tapping the laser's Bluetooth button switches
  between Smart and Ultra Low Power.
- **Level warning:** a blue droplet with "!" when the laser disagrees with a keg
  marked empty or cleaned. It replaces the mode warning in the same slot, without
  widening the group. It means the measurement is suspect, not that liquid or foam
  is definitely present.
- **The bar,** with a black outline: green from 100% to 50%, orange from 49% to 25%
  and red at 24% and below. The screen has no orange, so orange is a fixed pattern of
  2 red pixels to 1 yellow. The litres (`16.5L`, 64px) are centred in the bar, white
  over green or red and black over orange and the empty part, so a character the
  fill's edge crosses is split in two colours.

The firmware holds just the characters and icons the strip needs, as 1-bit pixel
tables made by `pnpm strip:glyphs` (see the [app README](../app/README.md)).

### Special states

- **Keg empty (kicked) or Keg ready (cleaned):** uploading either keg-state picture
  marks the keg as known empty. The strip shows `0%`, `0.0L` and an empty bar,
  regardless of the sensor, including after a restart or before its first reading.
  Readings continue in the background. A measured level of 10% or more (the same
  10-point threshold as a refill, about 1.9 L) shows the level warning after staying
  within 1 point for a minute; crossing below 10% clears it immediately. With no
  signal, the crossed-out Bluetooth icon takes the warning slot instead, while the
  known-zero numbers stay visible. Uploading a normal picture clears the override
  and starts from the latest measured level, or waits if none has been heard.
- **No laser chosen yet** (a new or factory reset tap): the strip says "No laser".
- **Waiting for laser 1:** a laser is chosen but has no level yet, after a minute's
  wait for its first reading. The top row says so (36px), with the mode icon in
  front, so a change of mode shows, and the bar shows a shrug, `¯\_(ツ)_/¯`. A mode
  warning, which may be why, goes in front in the icon's place. A laser not in
  `config/lasers.json` drops the number.
- **Can't hear laser 1:** with Smart chosen, nothing heard for 10 minutes. The laser
  broadcasts constantly in Smart, so that's a real problem (or the RAPT app is
  connected to it). The top row says so, with a crossed-out Bluetooth icon in front,
  in place of the percentage, battery and temperature, and the bar keeps the last
  level, or the shrug if there isn't one. With Eco chosen, a steady keg is silent for
  hours, so there's no warning. Flat batteries, the likely failure, show first as the
  red battery.
- **A broadcast without the temperature or battery:** the last known value stays.

There's no "last updated" time on the screen, as it would be frozen at the last
redraw; the web app's Status dialog shows when each laser was last heard.

## Redraw rules

A redraw takes about 22s and flashes the whole screen, so the tap redraws only when
something shown changes (`esp32/lib/Strip/StripTracker`):

| Value | Rule |
| --- | --- |
| Level | 1% steps, rounded down. It only goes down: a drop redraws as soon as the laser reports it, so a pour shows straight away. If the laser measured mid-pour, its next reading (about 35s later in Session) redraws again with the final level. A rise of 10 points or more is a refill, shown once the level has stayed within 1 point for a minute, as a keg change involves a lot of moving; it then shows the lowest reading in that minute. Smaller rises never show, such as the float's ball drifting under the laser. |
| Battery | The highest reading of the last hour, to ignore sags while the laser fires. That only goes down; a rise of 5 points or more (new batteries) shows straight away. |
| Temperature | Updated with every redraw. On its own, it redraws only after moving 0.5° or more, at most once an hour. |

Every redraw shows the latest of everything. A battery or temperature redraw waits
while a rise might still become a refill (up to a minute), so they come together. A
redraw can't be cut short, as stopping the panel part-way can leave lasting ghosting.
The strip's values are kept over a restart, and at startup the tap redraws only if
the screen would differ from the one it last drew. Force refresh in the web app's
settings redraws on demand.

## Setup help

With no picture saved (a newly flashed tap, or after a factory reset), the tap draws
setup help in the picture's square, in black and white (`esp32/lib/Strip/SetupHelp`):

1. **"Set up Tap 2",** while the tap's own network is open and it isn't on Wi-Fi: a
   QR code that offers to join that network, the network's name and password, and
   "Then the setup page opens".
2. **"Tap 2 is ready",** once on Wi-Fi: a QR code that opens the tap's page by IP
   address, which works on any phone on the same Wi-Fi, with the `.local` name and the
   address written out.

While the tap is still joining its saved Wi-Fi it draws nothing, so a tap about to
join doesn't redraw twice. It redraws when the screen or the IP address changes, and
the first picture replaces it for good. The titles are in Permanent Marker, the rest
in Roboto Bold.

`GET /setup-help?screen=join|ready` gives the drawing for the web app's preview, with
the password left out of its text and QR code.

## No laser on purpose

A tap can have no laser by choice (`POST /laser` with `address=none`). It then has no
strip: the whole 400 x 600 screen is the picture.

- `POST /image` takes either a 400 x 400 square (80,000 bytes) or the whole screen
  (120,000 bytes). With a laser, the tap draws a whole-screen picture's middle square,
  above the strip. With no laser on purpose there's never a strip: a square picture,
  or the setup help, sits in the middle on white bands until a whole-screen picture
  arrives.
- The web app composes the square as usual, and fills the 100px bands above and
  below with the chosen background. The library keeps the middle square, so every
  beer is a square that works on any tap.
- `esp32/lib/Strip/ScreenLayout` works out where a picture goes, and the web app's
  `web/src/screen.ts` does the same for the preview, tested against the same cases.

No laser chosen yet (a new tap) is different: it still has the strip, saying "No
laser", as a prompt to choose one.

## A picture and its laser together

Nothing reaches the screen until Upload to display. A laser picked in the web app
goes into the preview first, and Upload to display sends the picture with its laser
in one request (`POST /image?laser=…&mode=…`), checked before the picture is saved,
so neither is saved if the laser is turned down. The tap then leaves the redraw to
the laser's rules, so the screen changes once: for a new laser, when its first
reading arrives, or after a minute saying it's waiting for it (an Eco laser's first
reading can take up to an hour); straight away for a new mode of the same laser, or
for no laser. Without a new picture, the laser goes on its own (`POST /laser`).

`GET /strip` includes the laser chosen, so a choice made from another page shows in
the web app within 15s.

## How the page drew it

Upload to display also sends how the page drew a keg state or text (`source` with
`POST /image`: the state, line and date, or the words, font, size, colour and
background, as JSON, up to 1 KB). The tap keeps it beside the picture, unread, until
another picture replaces it, and gives it back in `GET /status` (`image.source`). The
page can then draw it again for the other layout when the laser changes, as the tap
keeps only pixels and the Library never gives the same line twice. A beer needs none:
its middle square is the beer.

## Fitting the case's window

The case's frame covers a few pixels of each screen, more on some sides than others.
Each tap's profile has a fit (`"fit"` in `config/tap-N.json`, see the
[project README](../README.md#device-profiles)):

- `shiftX` and `shiftY` move the whole screen right and down by whole pixels
  (negative for left and up), so it's centred in the window.
- `bottomSlant`, for a window whose bottom edge isn't level, is how many pixels higher
  that edge is at the right than at the left. Each column of the bottom 200 rows moves
  to follow it. It's 0 on every tap: tried on tap 1, the bar's straight lines showed
  the steps.

The fit is built into the firmware, with no route or saved setting: the screen won't
move once it's screwed in, so a factory reset or a new ESP32 keeps it, and changing
it means changing the profile and uploading the firmware. The firmware applies it to
the finished screen just before drawing (`ScreenLayout::applyFit`), so the web app
and its preview are the same on every tap. Pixels only move, so nothing is blurred.

Once centred, the frame hides 14 pixels at the sides and 9 at the top and bottom on
every tap (`Strip::HiddenX` and `HiddenY`, the most any tap hides plus a pixel). The
strip, the test borders and the keg boards keep inside that. The web app's preview
shows what the frame hides with red and yellow stripes.

The fits were found with calibration screens with numbered bars along each edge,
read by eye and from photos. After fitting, the same picture on all three taps looked
the same in each window, and the gauges were within a bar of each other.

## Test values

For checking the strip on the real screen, `POST /strip/test` sets the strip's values
for 5 minutes, or until `POST /strip/live`: `percent`, `temperature`, `battery`, and
optionally `litres` (otherwise worked out from the percentage for a 19 L keg),
`modeWarning`, `noSignal` and `noReading` (`"true"`), `setupHelp` (`join` or `ready`),
and `laser` and `mode` to test with a laser that isn't the tap's own. Test values have
a 5px red border inside the strip's edge, or round the whole screen when the setup
help is shown, so they're never taken for the real thing. They're never saved, so a
restart comes back live, and `GET /status` gives `strip.testSecondsLeft`. The web app's
developer mode sends them with "Show on device".
