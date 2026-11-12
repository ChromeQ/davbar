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
        Canvas canvas{strip, Width, Height};

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
