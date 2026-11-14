#pragma once

#include <stddef.h>
#include <stdint.h>

// Draws the keg strip, the 400 x 200 area below the image, from the laser's
// values. It has no Arduino code, so it is tested on the laptop too
// (pio test -e native). The layout matches the mock-ups agreed on tap 1's
// screen; PLAN.md describes it.
namespace Strip
{
    constexpr int Width = 400;
    constexpr int Height = 200;
    // 2 pixels a byte, the left one in the high 4 bits, like the rest of the screen.
    constexpr size_t RowBytes = Width / 2;
    constexpr size_t Size = RowBytes * Height;
    // The red border round anything shown for a test, inside its edge, so it's
    // never taken for the real thing.
    constexpr int TestBorder = 5;

    // The panel's colour codes.
    enum Colour : uint8_t
    {
        Black = 0x0,
        White = 0x1,
        Yellow = 0x2,
        Red = 0x3,
        Blue = 0x5,
        Green = 0x6,
        // Not a panel code: drawn as 2 red pixels to 1 yellow, the mix the web
        // app's encoder makes of #FF5500.
        Orange = 0x10,
    };

    enum class Mode : uint8_t
    {
        Smart,
        Eco,
    };

    // What the strip shows. Values not known yet are left out.
    struct Values
    {
        // false shows "No laser" and nothing else.
        bool laserChosen;
        // 1-3 dots, matching the laser's lid, and the number in the messages
        // below. 0 for a laser not in config/lasers.json, which shows neither.
        uint8_t laserNumber;
        // The mode chosen for this tap, shown as the brain or leaf icon.
        Mode mode;
        // Without a level, the top row says "Waiting for laser 1" in place of
        // the values, and the bar shows a shrug.
        bool hasLevel;
        uint8_t percent;
        uint16_t litresTenths;
        bool hasTemperature;
        int16_t temperatureTenths;
        bool hasBattery;
        uint8_t batteryPercent;
        // The laser has been in the other mode for over an hour.
        bool modeWarning;
        // Nothing heard from the laser for too long: the top row says "Can't
        // hear laser 1" with the no signal icon, in place of the values, which
        // are as old as the bar's level. Hides the mode warning, as the laser's
        // mode isn't known then.
        bool noSignal;
        // Test values from the web app's "Show on device", not the laser's:
        // drawn with a red border inside the strip's edge.
        bool test;
    };

    // Draws the whole strip into strip, which must hold Size bytes.
    void draw(uint8_t* strip, const Values& values);

    // Whether two sets of values draw the same strip.
    bool sameValues(const Values& a, const Values& b);
}
