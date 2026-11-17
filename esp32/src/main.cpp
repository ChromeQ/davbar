#include <Arduino.h>

#include "DEV_Config.h"
#include "DeviceLog.h"
#include "ImageManager.h"
#include "LaserScanner.h"
#include "LibraryManager.h"
#include "SetupHelpManager.h"
#include "Storage.h"
#include "StripManager.h"
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

    startLibrary();

    Serial.println("Starting WiFi...");
    startWifi();

    Serial.println("Starting web server...");
    startWebServer();

    startLaserScanner();

    startStripManager();

    Serial.println("Ready");
}

void loop()
{
    processWifiManager();

    processImageManager();

    processLaserScanner();

    processStripManager();

    processSetupHelp();

    processDeviceLog();
}
