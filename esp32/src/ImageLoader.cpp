#include "ImageLoader.h"
#include <LittleFS.h>

bool loadImage(uint8_t *buffer)
{
    File file = LittleFS.open("/image.bin", "r");

    if (!file)
    {
        Serial.println("Failed to open image.bin");
        return false;
    }

    if (file.size() != IMAGE_SIZE)
    {
        Serial.print("Invalid image size: ");
        Serial.println(file.size());
        file.close();
        return false;
    }

    size_t bytesRead = file.read(
        buffer,
        IMAGE_SIZE
    );

    file.close();

    if (bytesRead != IMAGE_SIZE)
    {
        Serial.println("Failed to read full image");
        return false;
    }

    Serial.println("Image loaded");

    return true;
}