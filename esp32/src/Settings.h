#pragma once

#include <Arduino.h>

// Settings kept in NVS, which no filesystem upload touches.

bool loadWifiSettings(String& ssid, String& password);

bool saveWifiSettings(const String& ssid, const String& password);

bool clearWifiSettings();

// The laser this tap shows ("E5:4C:66:F9:E1:33") and the mode it expects
// ("smart" or "eco"). Returns false when none is chosen.
bool loadLaserSettings(String& address, String& mode);

bool saveLaserSettings(const String& address, const String& mode);

bool clearLaserSettings();
