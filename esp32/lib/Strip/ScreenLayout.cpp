#include "ScreenLayout.h"

namespace ScreenLayout
{
    bool wholeScreen(bool noLaserOnPurpose, bool testValuesShowing)
    {
        return noLaserOnPurpose && !testValuesShowing;
    }

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
}
