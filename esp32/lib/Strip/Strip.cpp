#include "Strip.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "Draw.h"
#include "StripGlyphs.h"

namespace Strip
{
    namespace
    {
        using StripGlyphs::Font;
        using StripGlyphs::Icon;

        // The content keeps this far inside what the case's frame hides
        // (HiddenX and HiddenY, Strip.h), at the left, right and bottom.
        constexpr int Margin = 16;
        constexpr int Left = HiddenX + Margin;
        constexpr int Right = Width - HiddenX - Margin;
        constexpr int Bottom = Height - HiddenY - Margin;

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
        constexpr int CompactGap = 4;
        constexpr int WarningGap = 2;

        // Test values get TestBorder (Strip.h) just inside what the frame hides,
        // and the content keeps Margin from what it hides, so the border never
        // touches it.

        // The level bar, at the bottom
        constexpr int BarX = Left;
        constexpr int BarWidth = Right - Left;
        constexpr int BarHeight = 96;
        constexpr int BarY = Bottom - BarHeight;
        constexpr int BarBorder = 4;

        using Draw::Align;
        using Draw::Canvas;
        using Draw::drawIcon;
        using Draw::drawText;
        using Draw::plain;

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

        // Bluetooth's blue, crossed out in red.
        void drawNoSignal(const Canvas& canvas, int x, int y)
        {
            drawIcon(canvas, StripGlyphs::noSignal, x, y, Blue);
            drawIcon(canvas, StripGlyphs::noSignalStrike, x, y, Red);
        }

        // The mode chosen for this tap: a brain for Smart, a leaf for Eco.
        const Icon& modeIcon(Mode mode)
        {
            return mode == Mode::Eco ? StripGlyphs::leaf : StripGlyphs::brain;
        }

        // Like a road sign: yellow inside, with a black outline and "!".
        void drawModeWarning(const Canvas& canvas, int x, int y)
        {
            drawIcon(canvas, StripGlyphs::warningFill, x, y, Yellow);
            drawIcon(canvas, StripGlyphs::warning, x, y, Black);
        }

        // The laser dots, battery and mode icon, with the mode warning when
        // needed, centred on the screen so the icons line up across the taps.
        void drawGroup(const Canvas& canvas, const Values& values, int midY, int left, int right)
        {
            int iconWidth =
                DotRadius * 2 +
                BatteryWidth + NubWidth +
                IconSize +
                (values.modeWarning || values.levelWarning || values.noSignal ? WarningGap + IconSize : 0);
            int normalWidth = iconWidth + GroupGap * 2;
            int normalX = Width / 2 - normalWidth / 2;
            int gap = left + CompactGap > normalX || normalX + normalWidth + CompactGap > right
                ? CompactGap
                : GroupGap;
            int width = iconWidth + gap * 2;
            int x = Width / 2 - width / 2;
            int iconY = midY - IconSize / 2;

            int dots = values.laserNumber > MaxDots ? MaxDots : values.laserNumber;
            drawDots(canvas, x, midY, dots);
            x += DotRadius * 2 + gap;

            if (values.hasBattery)
            {
                drawBattery(canvas, x, midY - BatteryHeight / 2, values.batteryPercent);
            }
            x += BatteryWidth + NubWidth + gap;

            drawIcon(canvas, modeIcon(values.mode), x, iconY, Black);
            x += IconSize + WarningGap;

            if (values.noSignal)
            {
                drawNoSignal(canvas, x, iconY);
            }
            else if (values.levelWarning)
            {
                drawIcon(canvas, StripGlyphs::levelWarning, x, iconY, Blue);
            }
            else if (values.modeWarning)
            {
                drawModeWarning(canvas, x, iconY);
            }
        }

        // In place of the top row while there's no level, or nothing's been heard
        // from the laser: what the tap's waiting for, in words, with one icon in
        // front, centred together. It's the no signal icon, or the mode warning,
        // which may be why there's no reading, or otherwise the mode icon, so a
        // change of mode shows while waiting.
        void drawMessage(const Canvas& canvas, const Values& values)
        {
            const Font& font = StripGlyphs::messageFont;
            // An odd spare pixel goes above, as round letters reach a pixel past
            // the cap height.
            int capTop = (BarY - font.capHeight + 1) / 2;
            const char* words = values.noSignal ? "Can't hear laser" : "Waiting for laser";
            char text[24];

            // A laser not in config/lasers.json has no number.
            if (values.laserNumber > 0)
            {
                snprintf(text, sizeof(text), "%s %d", words, values.laserNumber);
            }
            else
            {
                snprintf(text, sizeof(text), "%s", words);
            }

            int textWidth = (Draw::textAdvance(font, text) + 15) / 16;
            int width = IconSize + GroupGap + textWidth;
            int x = Width / 2 - width / 2;
            int iconY = capTop + font.capHeight / 2 - IconSize / 2;

            // No signal hides the mode warning, as the laser's mode isn't known.
            if (values.noSignal)
            {
                drawNoSignal(canvas, x, iconY);
            }
            else if (values.modeWarning)
            {
                drawModeWarning(canvas, x, iconY);
            }
            else
            {
                drawIcon(canvas, modeIcon(values.mode), x, iconY, Black);
            }

            x += IconSize + GroupGap;

            drawText(canvas, font, text, x, capTop + font.capHeight, Align::Left, plain(Black));
        }

        void drawTopRow(const Canvas& canvas, const Values& values)
        {
            if (!values.hasLevel || (values.noSignal && !values.knownEmpty))
            {
                drawMessage(canvas, values);
                return;
            }

            const Font& font = StripGlyphs::rowFont;
            // An odd spare pixel goes above, as round letters reach a pixel past
            // the cap height.
            int capTop = (BarY - font.capHeight + 1) / 2;
            int baseline = capTop + font.capHeight;
            char text[12];

            snprintf(text, sizeof(text), "%d%%", values.percent);
            int left = Left + (Draw::textAdvance(font, text) + 15) / 16;
            int right = Right;
            drawText(canvas, font, text, Left, baseline, Align::Left, plain(Black));

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
                right -= (Draw::textAdvance(font, text) + 15) / 16;
                drawText(canvas, font, text, Right, baseline, Align::Right, plain(Black));
            }

            drawGroup(canvas, values, capTop + font.capHeight / 2, left, right);
        }

        // Green from 50%, orange from 25% and red below, with the litres centred.
        // With no level, a shrug.
        void drawBar(const Canvas& canvas, const Values& values)
        {
            canvas.strokeRect(BarX, BarY, BarWidth, BarHeight, BarBorder, Black);

            if (!values.hasLevel)
            {
                // Centred on its drawn pixels.
                const Icon& shrug = StripGlyphs::shrug;
                drawIcon(
                    canvas,
                    shrug,
                    Width / 2 - shrug.width / 2,
                    BarY + (BarHeight - shrug.height) / 2,
                    Black
                );
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
            a.knownEmpty == b.knownEmpty &&
            a.levelWarning == b.levelWarning &&
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
        Canvas canvas{strip, Width, Height};

        if (!values.laserChosen)
        {
            const Font& font = StripGlyphs::rowFont;
            drawText(
                canvas,
                font,
                "No laser",
                Width / 2,
                (Height - HiddenY + font.capHeight) / 2,
                Align::Centre,
                plain(Black)
            );
            return;
        }

        drawTopRow(canvas, values);
        drawBar(canvas, values);

        if (values.test)
        {
            // Just inside what the frame hides, and along the top, where the
            // strip meets the picture.
            canvas.strokeRect(HiddenX, 0, Width - HiddenX * 2, Height - HiddenY, TestBorder, Red);
        }
    }
}
