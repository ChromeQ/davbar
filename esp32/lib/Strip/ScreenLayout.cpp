#include "ScreenLayout.h"

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

    void drawTestBorder(uint8_t* screen)
    {
        constexpr int Width = RowBytes * 2;
        constexpr int Height = ScreenBytes / RowBytes;
        Draw::Canvas canvas{screen, Width, Height};
        canvas.strokeRect(0, 0, Width, Height, Strip::TestBorder, Strip::Red);
    }
}
