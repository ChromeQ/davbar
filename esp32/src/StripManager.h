#pragma once

#include <Arduino.h>
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
