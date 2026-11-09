#ifndef IMAGE_LOADER_H
#define IMAGE_LOADER_H

#include <Arduino.h>

#include "Screen.h"

// Reads the saved 400 x 400 image into the first IMAGE_SIZE bytes of buffer,
// the top 400 rows of the screen.
bool loadImage(uint8_t *buffer);

#endif
