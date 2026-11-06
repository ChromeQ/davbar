#pragma once

#include <Arduino.h>

// Settings kept in NVS, which no filesystem upload touches.

bool loadWifiSettings(String& ssid, String& password);

bool saveWifiSettings(const String& ssid, const String& password);

bool clearWifiSettings();
