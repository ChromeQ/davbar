#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>

// A rolling event log in the data partition, for checking what happened later.
// Entries are also printed to the serial port. They are held in memory and
// written every few minutes, to spare the flash, except rare ones that are
// written straight away (logEventNow).

// Starts the log and records the boot, with why the device restarted, written
// straight away.
void startDeviceLog();

// Records an event, such as "wifi lost", with optional details.
void logEvent(const char* event, const String& details = String());

// Records an event and writes it straight away, with anything held before it,
// so a power cut soon after doesn't lose it. For rare events: a boot, Wi-Fi
// saved, a laser chosen, a picture uploaded, a redraw, a beer saved or removed.
void logEventNow(const char* event, const String& details = String());

// Writes held entries when they are due. Call from loop().
void processDeviceLog();

// Writes held entries now, for example before a restart.
void flushDeviceLog();

bool clearDeviceLog();

// Sends the whole log as a CSV download.
void sendDeviceLog(AsyncWebServerRequest* request, const String& fileName);

// A short ID of the running firmware build, to tell builds apart in the log.
String firmwareId();
