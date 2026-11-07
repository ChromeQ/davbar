#pragma once

#include <ArduinoJson.h>

// Listens for RAPT Laser Level Sensor broadcasts and keeps the latest reading
// from each laser it hears. Until each tap chooses its laser (step 4), every
// laser is tracked.

void startLaserScanner();

// Logs changed readings, and every 5 minutes how many broadcasts each laser got
// through. Call from loop().
void processLaserScanner();

// Scanning shares the radio with WiFi, so it pauses for over-the-air updates
// and while WiFi connects. Each reason pauses and resumes on its own; scanning
// restarts when none is left.
enum class ScanPause : uint8_t
{
    Update = 1,
    WifiConnect = 2,
};

void pauseLaserScanner(ScanPause reason);

void resumeLaserScanner(ScanPause reason);

// Adds each laser's latest reading, for the status page.
void addLaserStatus(JsonArray lasers);
