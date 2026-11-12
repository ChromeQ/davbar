#ifndef IMAGE_LOADER_H
#define IMAGE_LOADER_H

#include <Arduino.h>

#include "Screen.h"

// Reads the saved picture, the 400 x 400 square or the whole 400 x 600 screen,
// into screen (SCREEN_SIZE bytes), placed for the layout (see
// lib/Strip/ScreenLayout.h): on the whole screen, or in the top 400 rows above the
// strip. Leaves the strip's rows alone on the square layout.
bool loadPicture(uint8_t* screen, bool wholeScreen);

#endif
