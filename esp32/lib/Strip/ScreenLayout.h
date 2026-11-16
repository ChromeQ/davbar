#pragma once

// Where the picture goes on the 400 x 600 screen (docs/display.md, No laser on
// purpose). Usually it's the 400 x 400 square above the strip. A tap with no
// laser on purpose has no strip, so its picture is the whole screen: the web app
// sends the square in the middle with its background filling the 100 rows above
// and below. Either size of picture can be saved, and shows on either layout.
//
// It has no Arduino code, so it is tested on the laptop too (pio test -e native).

#include <stddef.h>
#include <stdint.h>

namespace ScreenLayout
{
    // 2 pixels a byte, so 200 bytes a row.
    constexpr size_t RowBytes = 200;
    constexpr size_t ScreenBytes = RowBytes * 600;
    constexpr size_t SquareBytes = RowBytes * 400;
    // The 100 rows above the square on the whole screen, and the 100 below it.
    constexpr size_t BandBytes = RowBytes * 100;

    // A picture is the square or the whole screen.
    bool pictureSize(size_t bytes);

    // How a saved picture goes on the screen: which of its bytes, where they go in
    // the screen's bytes, and whether the bands above and below the square are
    // left white for want of a whole-screen picture.
    struct Placement
    {
        size_t from;
        size_t length;
        size_t to;
        bool whiteBands;
    };

    // For a picture of a valid size (pictureSize). A whole-screen picture on the
    // square layout gives its middle square, which is the beer's picture.
    Placement place(size_t pictureBytes, bool wholeScreen);

    // The test values' red border (Strip::TestBorder) round the whole screen,
    // just inside what the case's frame hides (Strip::HiddenX and HiddenY), for
    // the setup help shown by "Show on device", in place of the strip's own.
    // screen is the screen's bytes.
    void drawTestBorder(uint8_t* screen);

    // A tap's fit to its case's window, from its config (docs/display.md,
    // Fitting the case's window).
    struct Fit
    {
        // Moves the whole screen right and down, in pixels (negative for left
        // and up), so it's centred in the window.
        int shiftX;
        int shiftY;
        // For a window whose bottom edge isn't level: how many pixels higher the
        // edge is at the right than at the left. The bottom 200 rows (the strip,
        // on a tap with a laser) follow it: their left end moves down by half of
        // it and their right end up by half, each column by whole pixels.
        int bottomSlant;
    };

    // Applies the fit to the finished screen, just before it's drawn, so the web
    // app's preview never needs to know about it. Pixels only move, by whole
    // pixels, so nothing is blurred. What moves off the screen was under the
    // frame, and what opens up repeats the nearest pixel, under the frame too.
    void applyFit(uint8_t* screen, const Fit& fit);
}
