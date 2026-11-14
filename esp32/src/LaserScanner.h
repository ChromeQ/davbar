#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <RaptLaser.h>

// Listens for RAPT Laser Level Sensor broadcasts and keeps the latest reading
// from each laser it hears.
//
// Until this tap's laser is chosen, every laser is asked for its readings.
// After that, only the chosen one, so each laser answers one tap instead of
// three. The laser picker lifts that for a minute at a time (addLaserList), so
// it can show every laser live.

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

// Chooses this tap's laser by address ("E5:4C:66:F9:E1:33"), and the mode it
// expects ("smart", the default, or "eco"), and saves them in settings.
// "none" chooses no laser on purpose, for a tap without one: its picture is
// then the whole screen (PLAN.md, step 8). An empty address forgets the choice,
// so the strip asks for a laser again. Returns false with a message for the web
// app if the address or mode is wrong or saving fails.
bool chooseLaser(const String& address, const String& mode, String& error);

// Checks a choice as chooseLaser takes it, without making it: false with a
// message if it's wrong, otherwise changes says whether it differs from the
// current choice. For a picture sent with its laser (PLAN.md, step 8d).
bool checkLaserChoice(const String& address, const String& mode, bool& changes, String& error);

// The laser "Show on device" tests with, which may not be the tap's own.
struct TestLaser
{
    // No laser on purpose: the whole screen, with no strip
    bool noLaser;
    // Its number in config/lasers.json, or 0 for a laser not in it or none
    // chosen yet
    uint8_t number;
    bool eco;
};

// The laser to test with: one picked in the web app's preview and not sent yet
// (PLAN.md, step 8d), as chooseLaser takes it, so the screen shows what the
// preview does; or with an empty address, the tap's own. Nothing is saved.
// Returns false with a message if it's wrong.
bool readTestLaser(const String& address, const String& mode, TestLaser& laser, String& error);

// Forgets the chosen laser, for a factory reset.
bool clearLaserChoice();

// Whether this tap has no laser on purpose, rather than none chosen yet.
bool noLaserOnPurpose();

// Sets "laser" to the chosen laser (number, address and mode), or null, and
// "noLaser" to whether the tap has no laser on purpose.
void addChosenLaser(JsonObject response);

// This tap's laser and its latest reading, for the strip.
struct ChosenLaser
{
    bool chosen;
    uint8_t address[6];
    // Its number in config/lasers.json, or 0 for a laser not in it.
    uint8_t number;
    // The mode chosen for it: Eco (Ultra Low Power) or Smart.
    bool eco;
    // When it was last heard (millis), even without a reading. 0 when it
    // hasn't been heard since the tap started.
    unsigned long lastHeardAt;
    // The latest broadcast with a distance, and how many readings there have
    // been, which goes up with each new one.
    bool hasReading;
    RaptLaser::Reading reading;
    uint32_t readingCount;
};

ChosenLaser getChosenLaser();

// Adds each laser's latest reading, for the status page.
void addLaserStatus(JsonArray lasers);

// For the laser picker: the chosen laser, then "lasers" with every laser in
// config/lasers.json (heard or not) and any other RAPT laser heard. Asking also
// listens to every laser for the next minute.
void addLaserList(JsonObject response);
