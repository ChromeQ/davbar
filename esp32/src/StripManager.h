#pragma once

#include <Arduino.h>

// The keg strip below the image, drawn from this tap's laser.

// Draws the strip into strip (Strip::Size bytes), the rows below the image.
// Each redraw shows the laser's latest reading.
void drawStrip(uint8_t* strip);
