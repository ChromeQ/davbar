#include "ScreenLayout.h"

#include <string.h>

#include "Draw.h"
#include "Strip.h"

namespace ScreenLayout
{
    bool pictureSize(size_t bytes)
    {
        return bytes == SquareBytes || bytes == ScreenBytes;
    }

    Placement place(size_t pictureBytes, bool wholeScreen)
    {
        bool wholePicture = pictureBytes == ScreenBytes;

        if (wholePicture)
        {
            return wholeScreen
                ? Placement{0, ScreenBytes, 0, false}
                : Placement{BandBytes, SquareBytes, 0, false};
        }

        return wholeScreen
            ? Placement{0, SquareBytes, BandBytes, true}
            : Placement{0, SquareBytes, 0, false};
    }

    namespace
    {
        constexpr int Width = RowBytes * 2;
        constexpr int Height = ScreenBytes / RowBytes;
        // Where the bottom slant starts: the strip's top row.
        constexpr int BandTop = SquareBytes / RowBytes;

        uint8_t get(const uint8_t* screen, int x, int y)
        {
            uint8_t byte = screen[y * RowBytes + x / 2];
            return x % 2 == 0 ? byte >> 4 : byte & 0x0F;
        }

        void set(uint8_t* screen, int x, int y, uint8_t colour)
        {
            uint8_t& byte = screen[y * RowBytes + x / 2];
            byte = x % 2 == 0 ? (byte & 0x0F) | (colour << 4) : (byte & 0xF0) | colour;
        }

        int clamp(int value, int low, int high)
        {
            return value < low ? low : value > high ? high : value;
        }

        // How far the bottom slant moves column x down (negative for up): half
        // the slant at the left edge, the other half the other way at the right,
        // rounded to whole pixels.
        int slantAt(int x, int slant)
        {
            int twice = slant * (Width - 1 - 2 * x);
            int across = (Width - 1) * 2;
            return twice >= 0 ? (twice + across / 2) / across : -((-twice + across / 2) / across);
        }
    }

    void drawTestBorder(uint8_t* screen)
    {
        Draw::Canvas canvas{screen, Width, Height};
        canvas.strokeRect(
            Strip::HiddenX,
            Strip::HiddenY,
            Width - Strip::HiddenX * 2,
            Height - Strip::HiddenY * 2,
            Strip::TestBorder,
            Strip::Red
        );
    }

    void applyFit(uint8_t* screen, const Fit& fit)
    {
        // Each column of the bottom band moves on its own. Reading from the side
        // it's moving away from, so nothing is overwritten before it's read; from
        // above the band where it moves down, which carries the line between the
        // picture and the strip along with it.
        if (fit.bottomSlant != 0)
        {
            for (int x = 0; x < Width; x++)
            {
                int down = slantAt(x, fit.bottomSlant);
                if (down > 0)
                {
                    for (int y = Height - 1; y >= BandTop; y--)
                    {
                        set(screen, x, y, get(screen, x, y - down));
                    }
                }
                else if (down < 0)
                {
                    for (int y = BandTop; y < Height; y++)
                    {
                        set(screen, x, y, get(screen, x, clamp(y - down, 0, Height - 1)));
                    }
                }
            }
        }

        // Then the whole screen, rows and then pixels within each row, again
        // reading from the side it's moving away from.
        if (fit.shiftY > 0)
        {
            for (int y = Height - 1; y >= 0; y--)
            {
                int from = clamp(y - fit.shiftY, 0, Height - 1);
                memmove(screen + y * RowBytes, screen + from * RowBytes, RowBytes);
            }
        }
        else if (fit.shiftY < 0)
        {
            for (int y = 0; y < Height; y++)
            {
                int from = clamp(y - fit.shiftY, 0, Height - 1);
                memmove(screen + y * RowBytes, screen + from * RowBytes, RowBytes);
            }
        }

        if (fit.shiftX != 0)
        {
            for (int y = 0; y < Height; y++)
            {
                if (fit.shiftX > 0)
                {
                    for (int x = Width - 1; x >= 0; x--)
                    {
                        set(screen, x, y, get(screen, clamp(x - fit.shiftX, 0, Width - 1), y));
                    }
                }
                else
                {
                    for (int x = 0; x < Width; x++)
                    {
                        set(screen, x, y, get(screen, clamp(x - fit.shiftX, 0, Width - 1), y));
                    }
                }
            }
        }
    }
}
