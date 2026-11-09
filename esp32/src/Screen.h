#pragma once

// The screen is 400 x 600, stored 2 pixels a byte, so each row is 200 bytes.
// The uploaded image fills the top 400 rows and the firmware draws the keg
// strip in the 200 rows below it.
#define SCREEN_WIDTH 400
#define SCREEN_HEIGHT 600
#define SCREEN_SIZE ((SCREEN_WIDTH * SCREEN_HEIGHT) / 2)

#define IMAGE_HEIGHT 400
#define IMAGE_SIZE ((SCREEN_WIDTH * IMAGE_HEIGHT) / 2)

#define STRIP_HEIGHT (SCREEN_HEIGHT - IMAGE_HEIGHT)
