#include <LittleFS.h>
#include "EPD_4in0e.h"
#include "ImageLoader.h"

foo

uint8_t imageBuffer[IMAGE_SIZE];

void setup()
{
    DEV_Module_Init();

    Serial.println("Mounting filesystem...");

    if (!LittleFS.begin())
    {
        Serial.println("LittleFS mount failed");
        return;
    }

    EPD_4IN0E_Init();

    if (loadImage(imageBuffer))
    {
        EPD_4IN0E_Display(imageBuffer);
    }

    EPD_4IN0E_Sleep();

    DEV_Module_Exit();
}

void loop()
{
}