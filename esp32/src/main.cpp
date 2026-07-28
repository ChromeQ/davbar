#include <Arduino.h>
#include <LittleFS.h>

#include "DEV_Config.h"
#include "ImageManager.h"
#include "WifiManager.h"

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

    requestImageUpdate();

    Serial.println("Ready");
}

void loop()
{
    processWifiManager();

    processImageManager();
}