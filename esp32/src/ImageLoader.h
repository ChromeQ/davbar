#ifndef IMAGE_LOADER_H
#define IMAGE_LOADER_H

#include <Arduino.h>

#define IMAGE_WIDTH 400
#define IMAGE_HEIGHT 600
#define IMAGE_SIZE ((IMAGE_WIDTH * IMAGE_HEIGHT) / 2)

bool loadImage(uint8_t *buffer);

#endif