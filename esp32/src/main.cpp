#include <Arduino.h>

#include "DEV_Config.h"
#include "DeviceLog.h"
#include "ImageManager.h"
#include "Storage.h"
#include "WifiManager.h"

void setup()
{
    delay(4000);

    DEV_Module_Init();

    // Keep going if a filesystem fails to mount: WiFi and the web server
    // still start, so the problem can be seen and fixed.
    bool storageMounted = mountStorage();

    startDeviceLog();
    if (!storageMounted)
    {
        logEvent("storage error", "a filesystem failed to mount, see the serial output");
    }

    Serial.println("Starting WiFi...");
    startWifi();

    Serial.println("Starting web server...");
    startWebServer();

    requestImageUpdate("boot");

    Serial.println("Ready");
}

void loop()
{
    processWifiManager();

    processImageManager();

    processDeviceLog();
}
