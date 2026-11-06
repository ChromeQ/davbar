#pragma once

#include <LittleFS.h>

// The "store" partition: the screen image, kept apart from the web app files
// in LittleFS so filesystem uploads never erase it.
extern fs::LittleFSFS DataFS;

bool mountStorage();
