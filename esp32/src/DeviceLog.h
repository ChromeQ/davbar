#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>

// A rolling event log in the data partition, for checking what happened later.
// Entries are also printed to the serial port. They are held in memory and
// written every few minutes, to spare the flash.

// Starts the log and records the boot, with why the device restarted.
void startDeviceLog();

// Records an event, such as "wifi lost", with optional details.
void logEvent(const char* event, const String& details = String());

// Writes held entries when they are due. Call from loop().
void processDeviceLog();

// Writes held entries now, for example before a restart.
void flushDeviceLog();

bool clearDeviceLog();

// Sends the whole log as a CSV download.
void sendDeviceLog(AsyncWebServerRequest* request, const String& fileName);

// A short ID of the running firmware build, to tell builds apart in the log.
String firmwareId();
