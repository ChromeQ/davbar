# RAPT Laser Level Sensor

Each keg has a KegLand RAPT Laser Level Sensor in its lid (the Cornelius keg lid kit).
It measures the distance down to the beer and broadcasts it over Bluetooth. The taps
read those broadcasts and work out the litres left. The lasers are labelled with 1 to
3 dots on their lids, and `config/lasers.json` gives each number its address.

The firmware's decoder is `esp32/lib/RaptLaser`, and the web app's is
`app/rapt-laser` (with a command to decode one by hand, see the
[app README](../app/README.md)). Both follow this page and are tested against the same
captures and keg levels.

## Hearing it

The tap never connects to a laser. It does have to ask for the readings, though: the
advertisement holds only the service UUID, and the reading is in the scan response,
which the laser sends only to a scanner that asks for it (active scanning). Phones,
nRF Connect and laptops do this by default and show both merged. Listening passively,
a tap heard a laser in Smart Mode a few times an hour at best; scanning actively, it
hears each one about 36 times a minute, with the longest gap about 15s.

Once a tap has chosen its laser, it asks only that one (the Bluetooth controller's
accept list), so each laser answers one tap. While the laser picker is open, the tap
asks every laser, so they all show.

While the RAPT app is connected to a laser, the laser broadcasts nothing at all, so a
few minutes in the app can look like a lost signal. The tap waits 10 minutes before
saying it can't hear its laser.

## Modes

| Mode | Behaviour |
| --- | --- |
| 1, Smart (the default) | Broadcasts constantly. It measures regularly but only changes the reading it broadcasts when the level changes: a steady keg sends the same reading, byte for byte, for hours. |
| 2, Session | Entered by itself when the level changes: a new reading about every 35s, then back to the previous mode a few minutes after the level settles. Readings jitter by 1-3 mm. |
| 3, Live Stream | A fresh reading about every second, ending by itself after a few minutes. Useful for filling kegs and testing; drains the battery. |
| 4, Ultra Low Power | Wakes on a grid of 30 minutes 7 seconds. After a level change it reports in most slots for a few hours (the first report 16-52 minutes after the change), then goes silent while the level stays steady (10 hours and more). Each broadcast lasts 2-5 seconds. |

The web app calls Smart "Smart" and Ultra Low Power "Eco". Whether Eco reports a
single pint (about 14 mm) hasn't been tested.

Buttons ([RAPT docs](https://docs.rapt.io/equipment/rapt-laser-level-sensor/operation)):

- Bluetooth, single press: takes a reading and broadcasts it.
- Bluetooth, double tap: switches between Smart and Ultra Low Power. It's the only
  way out of Ultra Low Power.
- Bluetooth, held for about 2s: starts or stops Live Stream (the light flashes amber).
- Power, single press: shows the mode as 1-4 green flashes.

A battery change or restart puts the laser back in Smart. The battery reading sags
while the laser fires (as low as 76.7% in Session and Live Stream, against 85% in
Smart), which is why the strip shows the highest battery reading of the last hour.

## Broadcast format

The advertisement (a connectable `ADV_IND`) holds the flags (`0x06`) and the 128-bit
service UUID `52415054-0a06-9215-08bf-f2b018840000` ("RAPT"). The scan response holds
manufacturer data: company ID `0x4152` ("RA"), then a 19-byte payload. Values of more
than one byte are little-endian.

| Offset | Size | Field | Notes |
| --- | --- | --- | --- |
| 0 | 2 | `50 54` ("PT") | Signature |
| 2 | 1 | `A1` | Format or device type; the only value seen. Other RAPT devices, such as the Pill, share the company ID, so anything else is ignored |
| 3 | 6 | Address | As the RAPT app shows it |
| 9 | 2 | Distance, mm | 0 when there's no reading |
| 11 | 2 | Liquid height, mm | The vessel height set in the RAPT app less the distance; not used |
| 13 | 1 | Unknown (10) | Not used |
| 14 | 2 | Battery, 0.1% | `FFFF` when missing. The RAPT app rounds it down |
| 16 | 2 | Temperature, 0.01 °C, signed | Moves in 0.25 °C steps. `0x8000` when missing |
| 18 | 1 | Mode | 1 Smart, 2 Session, 3 Live Stream, 4 Ultra Low Power |

Distance plus liquid height is always 560. The RAPT app's distance comes from a
separate measurement and has differed from the broadcast's by 3-9 mm; the taps use the
broadcast's.

Some broadcasts have no reading (the second capture below), for example while the
RAPT app is connected or just after it forces a reading. The taps ignore them. To
capture one with a reading: close the RAPT app, press the laser's Bluetooth button,
wait 10-15s, then copy the data.

### Captures

Payloads after the company ID, used by both decoders' tests:

| Payload | Decoded |
| --- | --- |
| `5054A1E54C66F9E13313001D020AE803B70703` | Distance 19 mm, height 541 mm, battery 1000, 19.75 °C |
| `5054A1E54C66F9E1330000000000FFFF008001` | No reading (every value missing) |
| `5054A1E54C66F9E1338500AB010AE8031B0801` | Distance 133 mm, height 427 mm, battery 1000, 20.75 °C |
| `5054A1E54C66F9E1337001C0000A5103850701` | Distance 368 mm, height 192 mm, battery 849 (old batteries; the RAPT app showed 84%), 19.25 °C |
| `5054A1E54C66F9E133C1006F010A5703210702` | Distance 193 mm, height 367 mm, battery 855, 18.25 °C, Session |
| `5054A1E54C66F9E133E90047010AFF02530703` | Distance 233 mm, height 327 mm, battery 767 (sagging while the laser fires), 18.75 °C, Live Stream |
| `5054A1E54C66F9E133DB0055010A5B039E0704` | Distance 219 mm, height 341 mm, battery 859, 19.50 °C, Ultra Low Power |

The advertisement and scan response for the 133 mm capture, merged as nRF Connect
shows them (the advertisement ends after `...54504152`):
`0x020106110700008418B0F2BF081592060A5450415216FF52415054A1E54C66F9E1338500AB010AE8031B0801`

## Litres and percentage

The laser only gives a distance, so the tap works out the litres itself, from points
measured on a real 19 L Corny keg (see Calibration, below). Between two points the
litres are on the straight line between them; beyond the first point the keg is
empty, and nearer than the last it's full. The litres are rounded down to 0.1 L, and
the percentage is of 19 L, rounded down.

| Distance | Litres | Why |
| --- | --- | --- |
| 539 mm or more | 0 | Empty |
| 532, 508, 494, 477, 457, 440 mm | 0.5, 1, 1.5, 2, 2.5, 3 | The domed bottom, as measured with the float tied up, then 25 mm closer for the float's ball (below) |
| 399 mm | 5 | Where the bottom joins the straight sides |
| 45 mm | 18 | The straight sides: one line, 27.2 mm a litre, fitted to the readings from 5 L to 18.5 L |
| 29 mm or less | 19 | Full: the laser reads short this close |

The points are `RaptLaser::Corny19L` in the firmware and `CORNY_KEG_19L` in
`app/rapt-laser`, which must stay the same. The bottom points are written as the
distances measured, less `BallAboveBeerMm` (25), so the readings themselves are kept.
One table serves every keg, as the lasers sit alike in their lids: each read 84-89 mm
on its 85 mm delivery box. The distance is from about the underside of the lid, as
the laser's housing hangs about 15 mm below it.

What the screen shows, then:

- From 5 L up, within 0.2 L of what's in the keg.
- In the last 3 L, never more than what's there. With the float's ball under the beam
  it's right; with the ball out of the way it shows up to about 1 L less, a pint or
  two to spare at the end rather than one that isn't there.
- The screen's level only goes down (see [the redraw rules](display.md#redraw-rules)),
  so once the ball drifts away, the screen drops to the true level and stays there.

### The float's ball

The kegs use a floating dip tube: a silicone tube with a 42 mm stainless ball on the
end, which floats at the surface. With plenty in the keg, the tube curls round the
keg's side, out of the beam. Near the bottom it hangs straight down, and the curved
bottom steers the ball to the middle, under the laser. The laser then reads the top
of the ball instead of the beer:

- Floating, about 25 mm of the ball sits above the beer. In one filling, at 1.5 L,
  the reading went from 533 mm to 508 mm when the ball drifted under the beam, stayed
  there for an hour, and came back within 3 minutes of being moved away.
- Resting on the bottom of an empty keg, the ball's top could be up to 42 mm above
  the bottom. On an empty keg it only read 8-16 mm closer (548-556 mm against 564 mm),
  probably the beam catching the ball's side, as the laser is off-centre. Those read
  as 0 L.
- The worst case, the top of a resting ball right under the beam, would read about
  522 mm and show 0.7 L. The table can't allow for it, because 0.7 L with the ball
  floating also reads about 522 mm.

Keeping the ball out of the beam would fix it at the source, for example with a
shorter tube.

A rise of less than 10 percentage points never shows on the screen, partly because
the ball under the beam reads up to about 5 points high in the straight part.

### Calibration

Done on 2026-11-16 with an empty Corny keg, a 0.5 L measuring jug and tap water,
watched through a tap's `GET /lasers`. After each pour the lid went back on and the
laser's Bluetooth button was held for about 2s to start Live Stream; a point counts
once 4 readings in a row agree within 2 mm.

The first filling had the float in, and went to 19 L, 0.5 L at a time at the bottom
and top and 2 L at a time in the middle:

| In keg | Laser | Readings, range |
| --- | --- | --- |
| 0 L | 566 mm | 9, 566-568 |
| 0.5 L | 557 mm | 4, 556-558 |
| 1 L | 546 mm | 5, 545-548 |
| 1.5 L | 528 mm | 5, 527-530 |
| 2 L | 512 mm | 5, 511-514 |
| 2.5 L | 487 mm | 4, 486-488 |
| 3 L | 467 mm | 5, 465-468 |
| 5 L | 402 mm | 4, 401-403 |
| 7 L | 343 mm | 6, 342-347 |
| 9 L | 288 mm | 6, 286-290 |
| 11 L | 236 mm | 4, 235-236 |
| 13 L | 180 mm | 4, 179-180 |
| 15 L | 126 mm | 6, 124-127 |
| 15.5 L | 110 mm | 4, 110 |
| 16 L | 97 mm | 4, 96-98 |
| 16.5 L | 85 mm | 5, 84-87 |
| 17 L | 72 mm | 4, 71-72 |
| 17.5 L | 58 mm | 10, 55-60 |
| 18 L | 49 mm | 4, 47-49 |
| 18.5 L | 32 mm | 4, 32-34 |
| 19 L | 29 mm | 5, 27-31 |

The second filling had the float tied up out of the beam and the bottom dried first,
and went to 9 L:

| In keg | Laser |
| --- | --- |
| 0 L | 564 mm (563-566) |
| 0.5 L | 557 mm (556-558) |
| 1 L | 533 mm (531-534) |
| 1.5 L | 519 mm (519-524) |
| 2 L | 502 mm (499-504) |
| 2.5 L | 482 mm (481-484), creeping to 475-478 over 15 minutes |
| 3 L | 465 mm (463-465) |
| 5 L | 399 mm, settling to 402 |
| 7 L | 344 mm (343-345) |
| 9 L | 291 mm (290-291) |

What they show:

- The keg is a straight cylinder from about 3 L to the top, 27.2 mm a litre. The two
  fillings agree within 3 mm from 5 L up. The step from 3 L to 5 L is bigger than the
  straight sides account for (65 mm against 54 mm) in both fillings, so it's the
  keg's shape.
- The bottom repeats to about 0.3 L between fillings: the second read up to 13 mm
  closer between 1 L and 2.5 L, all of it from the pour from 0.5 L to 1 L. A few mm of
  water left in the bottom read 4-6 mm closer than a dry keg.
- Above 18.5 L the laser is as close as it can measure: 19 L read only 3 mm nearer
  than 18.5 L, and the laser read 21-23 mm whenever the lid was lifted off.
- Weighing (bathroom scales, weighed holding the keg less weighed without it): 23.4
  kg full with 19 L by the jug, 4.3 kg empty, so 19.1 kg of water. The jug was right,
  within what the scales can tell.

The table's bottom points are the second filling's, as the float was out of the way;
the straight part is the line fitted to the first filling from 5 L to 18.5 L.

Before the calibration the taps used a straight line from 552 mm (empty) to 22 mm
(19 L), which matched the RAPT app's own figures but read up to 0.8 L low in the last
3 L, where it matters most whether there's another pint.

To calibrate again, for another kind of keg or float: fill from a jug as above,
watching `GET /lasers` on a tap with that laser chosen, then change the points in
both decoders and their tests. Keep the measured distances in the code as they were
read, with any adjustment as a named constant.

Still to check: what the screen shows when a real keg runs dry. More than about 0.3
L would mean the resting ball's full height reaches the beam, and the empty point
should go deeper, by up to 42 mm.
