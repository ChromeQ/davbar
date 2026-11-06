#pragma once

#include <LittleFS.h>

// The "store" partition: the screen image and device log, kept apart from the
// web app files in LittleFS so filesystem uploads never erase them.
extern fs::LittleFSFS DataFS;

bool mountStorage();

// Removes a file from the data partition if it exists. Removing a missing file
// directly logs a misleading error. Returns false only if the removal failed.
bool removeDataFile(const String& path);
