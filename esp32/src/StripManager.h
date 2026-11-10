#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Strip.h>

// The keg strip below the image: what it shows, and when it redraws.

// After storage and the laser scanner start: picks up what the strip showed
// before a restart, so the screen doesn't change until something does.
void startStripManager();

// Follows the chosen laser's readings and asks for a redraw when the strip
// should change, by the redraw rules in PLAN.md. Call from loop().
void processStripManager();

// What the strip should show now. Every redraw uses it, whatever its reason.
Strip::Values stripValues();

// After a redraw, or a skipped or failed one: the strip shows values, and they
// are saved for after a restart.
void stripShown(const Strip::Values& values);

// For the device log: "79%, 15.0 L, 18.3°, battery 100%".
String stripDescription(const Strip::Values& values);

// Forgets the saved values, for a factory reset.
bool clearStripValues();

// For the web app's "Show on device": shows these values instead of the
// laser's, with a red border, for 5 minutes or until showLiveValues(). Each is
// a form field: percent (0-100), temperature (°C, -20 to 50), battery (0-100),
// and optionally litres (0-19; otherwise worked out from percent), modeWarning
// and noSignal ("true"). Returns false with a message for the web app if one is
// missing or out of range.
bool showTestValues(
    const String& percent,
    const String& litres,
    const String& temperature,
    const String& battery,
    const String& modeWarning,
    const String& noSignal,
    String& error
);

// Goes back to the laser's values, if test values are showing.
void showLiveValues();

// Sets "values" to what the strip would show now, for the web app's preview,
// and "testSecondsLeft" to how long test values have left, or null.
void addStripStatus(JsonObject strip);
