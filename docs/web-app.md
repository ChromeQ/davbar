# The web app

Each tap serves the web app at `http://<hostname>-<deviceId>.local` (for example
`http://davbar-tap1.local`), as one gzipped page. A large badge in the header says
which tap it is, with a dropdown linking to the other taps' pages, built from the
profiles in `config/`. The code is in `app/web`.

The page has two parts: Compose, where the picture is made, and the preview, which
shows the whole screen as the tap will draw it. Nothing reaches the screen until
Upload to display.

## Compose

Image mode takes an image of any size and zooms it into the 400 x 400 square. Ways
to give it one:

- Browse for a file, or drop one on the image (including an image dragged from
  another tab).
- The "Paste an image or its address" field: pasting an image's address loads it
  straight away, and so does typing one and pressing Enter. Pasting a picture (Copy
  Image, or a screenshot) loads it too, on a laptop or a phone.
- Ctrl+V anywhere on the page, outside a text field.
- The Library (below).

A failed address keeps the current image and says why: the site doesn't let other
pages read its images, the address is a page rather than an image, or the status the
site answered with. KegLand's product images can be read; their product pages can't.

Zoom:

- Fit shows the whole image, with a background in the gaps; Fill covers the square.
- The Zoom slider goes from the case's window up to 3 times Fill, on a log scale, with
  marks at Fit and Fill that it snaps to within 3%.
- The Frame dropdown fits the image to the case's window: Frame: W for its width,
  Frame: H for its height. The slider snaps to these too.
- Where the image is bigger than the square, dragging it chooses which part shows,
  and zooming keeps the same point in the middle. A new image starts at Fit, or at
  Fill if the last one was at Fill.

The Background tool shows whenever the image leaves gaps: a solid colour (white to
start), a linear gradient (top to bottom) or radial gradient (out from the middle)
with a button to swap the colours, or the same image blurred behind it. Each colour
has the screen's six colours as swatches, as they come out clean while other colours
are dithered, and an eyedropper: desktop Chrome's own, which picks from anywhere on
screen, or elsewhere a click on the image.

Text mode draws text at 400 x 400, black on white to start, with the same colour
picker and Background tool (without the blurred image). Each mode keeps its own
settings.

"Edit the picture on the tap", in Compose's empty box, loads what the tap shows, so
it can be changed. For a beer, that's its original from the library, as it was before
the six colours; for text or a keg state, it's drawn again from how the page drew it;
otherwise it's the tap's six-colour copy.

## Preview

The preview shows the whole 400 x 600 screen: the picture in the tap's six colours,
dithered as the tap will show them, and a copy of the strip with the tap's live
readings. Until something new is composed, it shows the picture on the tap (`GET
/image`, labelled "On the tap"); Reset image goes back to it.

Red and yellow stripes show what the case's frame hides, see-through, with the
picture under them blurred, and a line along the window's edge. The button beside the
preview's heading turns them off, remembered by that browser.

The Laser button beside Upload to display shows the tap's laser, and opens the laser
picker: No laser first, then every laser in `config/lasers.json` with its dots and,
when heard recently, its reading, mode and when it was last heard. A laser in Eco may
not be heard yet, so check the dots on its lid. The picker also sets the mode this tap
expects:

- Smart (the default): the screen a few minutes behind a pour, the RAPT app works,
  batteries changed more often.
- Eco (Ultra Low Power): batteries last longer, the screen up to about an hour behind.

A laser in the other mode says how to fix it: "double-tap its Bluetooth button".
Picking a laser puts it in the preview, marked "not sent yet", and Upload to display
sends it with the picture, so the screen redraws once for both (see
[the display](display.md#a-picture-and-its-laser-together)).

## The Library

Every beer uploaded in image mode is saved to that tap's library, so each tap keeps a
copy of every beer it has shown and a dead tap loses nothing. A tap holds up to 30.

- The Library button opens one grid of thumbnails from all the taps, each beer once,
  last shown first, with where and when it was last shown under it ("Tap 2 · 11 Nov")
  and this tap's count ("12 of 30 on this tap"). Picking one loads it into Compose.
  Any tap that couldn't be reached is listed.
- A beer picked from the library and uploaded unchanged goes back as its own JPEG, so
  it stays the same beer (its ID is its JPEG's CRC-32); zoomed, it's a new beer.
- To remove beers, tick them (the round tick in each corner, on hover with a mouse),
  then "Remove 3". It asks once more ("Their pictures can't be got back"), then asks
  each tap to remove the ones it has. A tap that couldn't be reached keeps its copies,
  and the grid says so.
- When this tap is full, the picture still goes to the screen, and the upload's
  message says it wasn't saved, with "Make room…": the grid on this tap's beers,
  ready to choose, then "Remove 2 and save". Nothing is ever removed automatically,
  as the oldest beers may be the ones made most often.

The page does the image work: it saves the composed square, before the six colours,
as a JPEG of at most 70 KB, lowering the quality until it fits, with a 200 x 200
thumbnail of at most 16 KB. The tap only stores, lists and removes them (`GET
/library`, `POST /library`, `POST /library/remove`, see the
[firmware README](../esp32/README.md#routes)).

## Keg states

Two boards always come first in the Library: "Keg empty" and "Keg ready" (cleaned and
ready to fill). They can't be ticked or removed, and they're never saved to the
library. Nothing switches to them automatically; the strip still shows the laser's
reading.

Each is a pub chalkboard: black with a double white border, a worn rubber stamp
across the middle (red KEG EMPTY or green KEG READY), a line in chalk above it (white
when empty, yellow when ready) and the date below ("Kicked 9 Nov" or "Cleaned 9 Nov").

- The line comes from the lists in `config/keg-lines.json`, never the one taken last
  time (remembered by each browser for each tap). Lines can be added there without
  changing code. The build checks each one: at most 24 characters, as longer lines
  shrink too small to read, and only characters the chalk font has.
- While a keg state is in Compose, its date and line show in place of the zoom: a
  date field (never after today) with Today and Yesterday, Another line, and a Line
  field for a one-off message, with a count of its characters. A typed line follows
  the same rules (`web/src/keg-line-rules.ts`, shared with the build's check) and isn't
  added to the list.
- The page draws the board when a state is picked, so the date is that day. A keg
  kicked last night with the screen updated in the morning: Edit the picture on the
  tap, Yesterday, then Upload to display.

## Developer mode

A switch in the settings menu, off by default and remembered by each browser for each
tap, adds Test values under the preview: the percentage and litres (linked, as the
tap works them out), temperature, battery, the mode warning, No signal, No reading,
and Setup help (Off, 1 or 2). The preview shows them, with a red border, and "Show on
device" sends them to the tap for 5 minutes (see
[the display](display.md#test-values)). While the tap shows test values, a countdown
and "Back to live" show under the preview, with or without developer mode.

## Settings

The menu has Status, Force refresh, Download log (a CSV file), Reboot and Factory
reset. Factory reset asks first, saying it clears Wi-Fi, the laser and the screen
image and restarts in setup, with two boxes, unticked: "Also clear the log" and "Also
clear this tap's beer library" (copies on other taps stay).

## Fonts

Roboto is built into both pages, so the setup page (whose phone has no internet) and
text mode always have it, trimmed to the weights and characters used. The keg states'
chalk, Permanent Marker (Apache License 2.0), is built into the app page only.
`pnpm fonts:subset` makes both.

## Phones

The page works on a phone on the same Wi-Fi. If Chrome on Android can't reach a tap
or even the router, check its Nearby devices permission (Android's local network
permission): turning it off and on again fixed it once. A VPN without access to the
local network hides the taps too. A phone sharing its own hotspot can't look up the
`.local` names, so use the tap's address there.
