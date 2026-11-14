#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <SetupHelp.h>
#include <Strip.h>

#include "LaserScanner.h"

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
// and noSignal ("true"). noReading ("true") takes no numbers, and shows the strip
// with no level, waiting for the laser, or not hearing it with noSignal. The
// strip has laser's dots and mode icon (readTestLaser), which may not be the
// tap's own. setupHelp, unless None, shows that setup help screen in
// place of the picture meanwhile, to check it on the real screen. Returns false
// with a message for the web app if one is missing or out of range, or if laser
// is no laser on purpose, which has no strip to test (showSetupHelpTest).
bool showTestValues(
    const String& percent,
    const String& litres,
    const String& temperature,
    const String& battery,
    const String& modeWarning,
    const String& noSignal,
    const String& noReading,
    const TestLaser& laser,
    SetupHelp::Screen setupHelp,
    String& error
);

// For "Show on device" with no laser on purpose, which has no strip to test:
// shows that setup help screen in place of the picture alone, on the whole
// screen, for 5 minutes or until showLiveValues(). The tap may have a laser of
// its own: the test is of no laser picked in the web app's preview.
void showSetupHelpTest(SetupHelp::Screen screen);

// Whether the picture fills the whole screen, with no strip: for no laser on
// purpose, or for a test of it, which may not be the tap's own. From the loop.
bool pictureFillsScreen();

// The setup help screen showing with the test values, or None. From the loop.
SetupHelp::Screen testSetupHelp();

// For a new laser choice: ends any test showing, as it was set up for the old
// choice, with no redraw of its own. The strip's redraw rules then show the new
// choice: once its first reading arrives (within a minute) for a laser, so the
// strip draws once with it, or straight away for none.
void endTestForLaserChoice();

// Goes back to the laser's values, if test values are showing.
void showLiveValues();

// Sets "values" to what the strip would show now, for the web app's preview,
// "testSecondsLeft" to how long test values have left, or null, and
// "setupHelp" to the setup help screen showing with them ("join" or "ready"),
// or null, and "laser" and "noLaser" to the laser chosen (addChosenLaser).
void addStripStatus(JsonObject strip);
