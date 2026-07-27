#include <LittleFS.h>

#include "DEV_Config.h"
#include "EPD_4in0e.h"
#include "ImageLoader.h"
#include "WifiManager.h"

uint8_t imageBuffer[IMAGE_SIZE];

void setup()
{
    delay(4000);

    DEV_Module_Init();

    Serial.println("Mounting filesystem...");
    if (!LittleFS.begin())
    {
        Serial.println("LittleFS mount failed");
        return;
    }

    // Remove WiFi credentials to force AP mode for testing
    // LittleFS.remove("/wifi.json");
    // Serial.println("Removed WiFi credentials");
    
    Serial.println("Connecting WiFi...");
    if (!connectWifi())
    {
        return;
    }
    
    Serial.println("Starting web server...");
    startWebServer();

    Serial.println("Initialising display...");
    EPD_4IN0E_Init();

    Serial.println("Loading image...");
    if (loadImage(imageBuffer))
    {
        Serial.println("Displaying image...");
        EPD_4IN0E_Display(imageBuffer);
    }
    else
    {
        Serial.println("No image found");
    }

    EPD_4IN0E_Sleep();

    DEV_Module_Exit();

    Serial.println("Ready");
}

void loop()
{
    processWifiManager();
}