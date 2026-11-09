#include "Strip.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "StripGlyphs.h"

namespace Strip
{
    namespace
    {
        using StripGlyphs::Font;
        using StripGlyphs::Glyph;
        using StripGlyphs::Icon;

        constexpr int Margin = 16;

        // The top row: the percentage, the middle group and the temperature,
        // centred between the image and the bar.
        constexpr int DotRadius = 4;
        constexpr int DotGap = 3;
        constexpr int MaxDots = 3;
        constexpr int BatteryWidth = 52;
        constexpr int BatteryHeight = 26;
        constexpr int BatteryBorder = 3;
        // Between the battery's outline and its fill.
        constexpr int BatteryInset = 2;
        constexpr int NubWidth = BatteryBorder + 1;
        constexpr int NubHeight = 10;
        constexpr int IconSize = 32;
        constexpr int GroupGap = 10;

        // Around test values. The content keeps Margin from every edge, so the
        // border never touches it.
        constexpr int TestBorder = 5;

        // The level bar
        constexpr int BarX = Margin;
        constexpr int BarY = 88;
        constexpr int BarWidth = Width - Margin * 2;
        constexpr int BarHeight = 96;
        constexpr int BarBorder = 4;

        struct Canvas
        {
            uint8_t* bytes;

            void set(int x, int y, Colour colour) const
            {
                if (x < 0 || x >= Width || y < 0 || y >= Height)
                {
                    return;
                }

                if (colour == Orange)
                {
                    colour = (x + y) % 3 == 0 ? Yellow : Red;
                }

                uint8_t& byte = bytes[y * RowBytes + x / 2];
                byte = x % 2 == 0
                    ? static_cast<uint8_t>((byte & 0x0F) | (colour << 4))
                    : static_cast<uint8_t>((byte & 0xF0) | colour);
            }

            void fillRect(int x, int y, int width, int height, Colour colour) const
            {
                for (int j = y; j < y + height; j++)
                {
                    for (int i = x; i < x + width; i++)
                    {
                        set(i, j, colour);
                    }
                }
            }

            void strokeRect(int x, int y, int width, int height, int border, Colour colour) const
            {
                fillRect(x, y, width, border, colour);
                fillRect(x, y + height - border, width, border, colour);
                fillRect(x, y, border, height, colour);
                fillRect(x + width - border, y, border, height, colour);
            }

            // The pixels within r + 0.3 of the centre, so small dots look round.
            void disc(int centreX, int centreY, int r, Colour colour) const
            {
                int limit = r * r * 10 + r * 6;
                for (int j = -r; j <= r; j++)
                {
                    for (int i = -r; i <= r; i++)
                    {
                        if ((i * i + j * j) * 10 <= limit)
                        {
                            set(centreX + i, centreY + j, colour);
                        }
                    }
                }
            }
        };

        // Each pixel of some text is `before` left of column `split`, and `after`
        // from it on, so text crossing the bar's fill contrasts with both sides.
        struct TextColour
        {
            Colour before;
            Colour after;
            int split;
        };

        TextColour plain(Colour colour)
        {
            return {colour, colour, 0};
        }

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
        )
        {
            int rowBytes = (width + 7) / 8;
            for (int j = 0; j < height; j++)
            {
                for (int i = 0; i < width; i++)
                {
                    if (bits[j * rowBytes + i / 8] & (0x80 >> (i % 8)))
                    {
                        int px = x + i;
                        canvas.set(px, y + j, px < colour.split ? colour.before : colour.after);
                    }
                }
            }
        }

        void drawIcon(const Canvas& canvas, const Icon& icon, int x, int y, Colour colour)
        {
            drawBits(canvas, icon.bits, icon.width, icon.height, x, y, plain(colour));
        }

        const Glyph* findGlyph(const Font& font, char character)
        {
            uint8_t code = static_cast<uint8_t>(character);
            for (uint8_t i = 0; i < font.glyphCount; i++)
            {
                if (font.glyphs[i].code == code)
                {
                    return &font.glyphs[i];
                }
            }

            return nullptr;
        }

        int kerning(const Font& font, char first, char second)
        {
            for (uint8_t i = 0; i < font.kerningCount; i++)
            {
                const StripGlyphs::Kerning& pair = font.kerning[i];
                if (
                    pair.first == static_cast<uint8_t>(first) &&
                    pair.second == static_cast<uint8_t>(second)
                )
                {
                    return pair.adjust;
                }
            }

            return 0;
        }

        // How far some text moves the pen, in 1/16 px. Characters the font
        // doesn't have are skipped.
        int32_t textAdvance(const Font& font, const char* text)
        {
            int32_t advance = 0;
            for (const char* character = text; *character; character++)
            {
                const Glyph* glyph = findGlyph(font, *character);
                if (glyph)
                {
                    advance += glyph->advance + kerning(font, character[0], character[1]);
                }
            }

            return advance;
        }

        // Text is Latin-1, so the degree sign is "\xB0". The pen moves in 1/16 px
        // and each character lands on the nearest whole pixel, as in the web
        // app's preview.
        void drawText(
            const Canvas& canvas,
            const Font& font,
            const char* text,
            int x,
            int baseline,
            Align align,
            TextColour colour
        )
        {
            int32_t advance = textAdvance(font, text);
            int32_t pen = x * 16;
            if (align == Align::Centre)
            {
                pen -= advance / 2;
            }
            else if (align == Align::Right)
            {
                pen -= advance;
            }

            for (const char* character = text; *character; character++)
            {
                const Glyph* glyph = findGlyph(font, *character);
                if (!glyph)
                {
                    continue;
                }

                drawBits(
                    canvas,
                    font.bits + glyph->offset,
                    glyph->width,
                    glyph->height,
                    ((pen + 8) >> 4) + glyph->left,
                    baseline + glyph->top,
                    colour
                );
                pen += glyph->advance + kerning(font, character[0], character[1]);
            }
        }

        // Black, with a green fill in 10% steps. Below 10%: red, with a red fill
        // and the percentage in 1% steps.
        void drawBattery(const Canvas& canvas, int x, int y, uint8_t percent)
        {
            if (percent > 100)
            {
                percent = 100;
            }

            bool low = percent < 10;
            Colour outline = low ? Red : Black;
            canvas.strokeRect(x, y, BatteryWidth, BatteryHeight, BatteryBorder, outline);
            canvas.fillRect(
                x + BatteryWidth,
                y + (BatteryHeight - NubHeight) / 2,
                NubWidth,
                NubHeight,
                outline
            );

            int innerX = x + BatteryBorder + BatteryInset;
            int innerY = y + BatteryBorder + BatteryInset;
            int innerWidth = BatteryWidth - (BatteryBorder + BatteryInset) * 2;
            int innerHeight = BatteryHeight - (BatteryBorder + BatteryInset) * 2;
            int fill = low
                ? (innerWidth * percent + 99) / 100
                : (innerWidth * (percent / 10) + 5) / 10;
            canvas.fillRect(innerX, innerY, fill, innerHeight, low ? Red : Green);

            if (low)
            {
                char text[4];
                snprintf(text, sizeof(text), "%d%%", percent);
                const Font& font = StripGlyphs::batteryFont;
                int capTop = y + (BatteryHeight - font.capHeight) / 2;
                drawText(
                    canvas,
                    font,
                    text,
                    x + BatteryWidth / 2,
                    capTop + font.capHeight,
                    Align::Centre,
                    {White, Red, innerX + fill}
                );
            }
        }

        // Stacked vertically and centred on midY, so the group is the same
        // width on every tap.
        void drawDots(const Canvas& canvas, int x, int midY, int count)
        {
            int height = count * DotRadius * 2 + (count - 1) * DotGap;
            for (int i = 0; i < count; i++)
            {
                int centreY = midY - height / 2 + DotRadius + i * (DotRadius * 2 + DotGap);
                canvas.disc(x + DotRadius, centreY, DotRadius, Black);
            }
        }

        // The laser dots, battery and mode icon, with the no signal icon or the
        // mode warning when needed, centred on the screen so the icons line up
        // across the taps.
        void drawGroup(const Canvas& canvas, const Values& values, int midY)
        {
            bool warning = values.modeWarning && !values.noSignal;
            int width =
                DotRadius * 2 + GroupGap +
                BatteryWidth + NubWidth + GroupGap +
                IconSize +
                (values.noSignal || warning ? GroupGap + IconSize : 0);
            int x = Width / 2 - width / 2;
            int iconY = midY - IconSize / 2;

            int dots = values.laserNumber > MaxDots ? MaxDots : values.laserNumber;
            drawDots(canvas, x, midY, dots);
            x += DotRadius * 2 + GroupGap;

            if (values.hasBattery)
            {
                drawBattery(canvas, x, midY - BatteryHeight / 2, values.batteryPercent);
            }
            x += BatteryWidth + NubWidth + GroupGap;

            // Bluetooth's blue, crossed out in red.
            if (values.noSignal)
            {
                drawIcon(canvas, StripGlyphs::noSignal, x, iconY, Blue);
                drawIcon(canvas, StripGlyphs::noSignalStrike, x, iconY, Red);
                x += IconSize + GroupGap;
            }

            const Icon& mode = values.mode == Mode::Eco ? StripGlyphs::leaf : StripGlyphs::brain;
            drawIcon(canvas, mode, x, iconY, Black);
            x += IconSize + GroupGap;

            // Like a road sign: yellow inside, with a black outline and "!".
            if (warning)
            {
                drawIcon(canvas, StripGlyphs::warningFill, x, iconY, Yellow);
                drawIcon(canvas, StripGlyphs::warning, x, iconY, Black);
            }
        }

        void drawTopRow(const Canvas& canvas, const Values& values)
        {
            const Font& font = StripGlyphs::rowFont;
            int capTop = (BarY - font.capHeight) / 2;
            int baseline = capTop + font.capHeight;
            char text[12];

            if (values.hasLevel)
            {
                snprintf(text, sizeof(text), "%d%%", values.percent);
                drawText(canvas, font, text, Margin, baseline, Align::Left, plain(Black));
            }

            if (values.hasTemperature)
            {
                int tenths = abs(values.temperatureTenths);
                snprintf(
                    text,
                    sizeof(text),
                    "%s%d.%d\xB0",
                    values.temperatureTenths < 0 ? "-" : "",
                    tenths / 10,
                    tenths % 10
                );
                drawText(canvas, font, text, Width - Margin, baseline, Align::Right, plain(Black));
            }

            drawGroup(canvas, values, capTop + font.capHeight / 2);
        }

        // Green from 50%, orange from 25% and red below, with the litres centred.
        void drawBar(const Canvas& canvas, const Values& values)
        {
            canvas.strokeRect(BarX, BarY, BarWidth, BarHeight, BarBorder, Black);

            if (!values.hasLevel)
            {
                return;
            }

            int percent = values.percent > 100 ? 100 : values.percent;
            int innerX = BarX + BarBorder;
            int innerY = BarY + BarBorder;
            int innerWidth = BarWidth - BarBorder * 2;
            int innerHeight = BarHeight - BarBorder * 2;
            int fill = (innerWidth * percent + 50) / 100;
            Colour colour = percent >= 50 ? Green : percent >= 25 ? Orange : Red;
            canvas.fillRect(innerX, innerY, fill, innerHeight, colour);

            char text[8];
            snprintf(
                text,
                sizeof(text),
                "%d.%dL",
                values.litresTenths / 10,
                values.litresTenths % 10
            );
            const Font& font = StripGlyphs::barFont;
            int capTop = BarY + (BarHeight - font.capHeight) / 2;
            // White over green and red, black over orange and the empty part.
            Colour onFill = colour == Orange ? Black : White;
            drawText(
                canvas,
                font,
                text,
                Width / 2,
                capTop + font.capHeight,
                Align::Centre,
                {onFill, Black, innerX + fill}
            );
        }
    }

    bool sameValues(const Values& a, const Values& b)
    {
        return a.laserChosen == b.laserChosen &&
            a.laserNumber == b.laserNumber &&
            a.mode == b.mode &&
            a.hasLevel == b.hasLevel &&
            a.percent == b.percent &&
            a.litresTenths == b.litresTenths &&
            a.hasTemperature == b.hasTemperature &&
            a.temperatureTenths == b.temperatureTenths &&
            a.hasBattery == b.hasBattery &&
            a.batteryPercent == b.batteryPercent &&
            a.modeWarning == b.modeWarning &&
            a.noSignal == b.noSignal &&
            a.test == b.test;
    }

    void draw(uint8_t* strip, const Values& values)
    {
        memset(strip, (White << 4) | White, Size);
        Canvas canvas{strip};

        if (!values.laserChosen)
        {
            const Font& font = StripGlyphs::rowFont;
            drawText(
                canvas,
                font,
                "No laser",
                Width / 2,
                (Height + font.capHeight) / 2,
                Align::Centre,
                plain(Black)
            );
            return;
        }

        drawTopRow(canvas, values);
        drawBar(canvas, values);

        if (values.test)
        {
            canvas.strokeRect(0, 0, Width, Height, TestBorder, Red);
        }
    }
}
