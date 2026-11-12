#include "ImageLoader.h"

#include <ScreenLayout.h>
#include <string.h>

#include "Storage.h"

static_assert(ScreenLayout::ScreenBytes == SCREEN_SIZE, "The layout's screen is the screen");
static_assert(ScreenLayout::SquareBytes == IMAGE_SIZE, "The layout's square is the picture's");

bool loadPicture(uint8_t* screen, bool wholeScreen)
{
    File file = DataFS.open("/image.bin", "r");

    if (!file)
    {
        Serial.println("Failed to open image.bin");
        return false;
    }

    size_t size = file.size();
    if (!ScreenLayout::pictureSize(size))
    {
        Serial.print("Invalid image size: ");
        Serial.println(size);
        file.close();
        return false;
    }

    ScreenLayout::Placement place = ScreenLayout::place(size, wholeScreen);
    bool read = file.seek(place.from) &&
        file.read(screen + place.to, place.length) == place.length;
    file.close();

    if (!read)
    {
        Serial.println("Failed to read full image");
        return false;
    }

    if (place.whiteBands)
    {
        const uint8_t white = 0x11;
        memset(screen, white, ScreenLayout::BandBytes);
        memset(screen + ScreenLayout::BandBytes + ScreenLayout::SquareBytes, white, ScreenLayout::BandBytes);
    }

    Serial.println("Image loaded");

    return true;
}
