#pragma once

// Drawing in the panel's colours, for the parts of the screen the firmware draws
// itself: the strip (Strip.h) and the setup help (SetupHelp.h). It has no
// Arduino code, so it is tested on the laptop too (pio test -e native).

#include <stdint.h>

#include "Strip.h"
#include "StripGlyphs.h"

namespace Draw
{
    using Strip::Colour;

    // An area of the screen, width x height pixels, stored 2 pixels a byte like
    // the rest of the screen, the left one in the high 4 bits.
    struct Canvas
    {
        uint8_t* bytes;
        int width;
        int height;

        // Pixels outside the area are left out.
        void set(int x, int y, Colour colour) const;
        void fillRect(int x, int y, int width, int height, Colour colour) const;
        void strokeRect(int x, int y, int width, int height, int border, Colour colour) const;
        // The pixels within r + 0.3 of the centre, so small dots look round.
        void disc(int centreX, int centreY, int r, Colour colour) const;
    };

    // Each pixel of some text is `before` left of column `split`, and `after`
    // from it on, so text crossing the bar's fill contrasts with both sides.
    struct TextColour
    {
        Colour before;
        Colour after;
        int split;
    };

    TextColour plain(Colour colour);

    enum class Align
    {
        Left,
        Centre,
        Right,
    };

    // 1-bit rows, each padded to whole bytes, the most significant bit on the left.
    void drawBits(
        const Canvas& canvas,
        const uint8_t* bits,
        int width,
        int height,
        int x,
        int y,
        TextColour colour
    );

    void drawIcon(const Canvas& canvas, const StripGlyphs::Icon& icon, int x, int y, Colour colour);

    // How far some text moves the pen, in 1/16 px. Characters the font doesn't
    // have are skipped.
    int32_t textAdvance(const StripGlyphs::Font& font, const char* text);

    // Text is Latin-1, so the degree sign is "\xB0". The pen moves in 1/16 px and
    // each character lands on the nearest whole pixel, as in the web app's
    // preview. x is the left, centre or right of the text, by align.
    void drawText(
        const Canvas& canvas,
        const StripGlyphs::Font& font,
        const char* text,
        int x,
        int baseline,
        Align align,
        TextColour colour
    );
}
