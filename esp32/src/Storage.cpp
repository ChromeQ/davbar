#include "Storage.h"

fs::LittleFSFS DataFS;

bool mountStorage()
{
    Serial.println("Mounting web app filesystem...");
    bool webMounted = LittleFS.begin();
    if (!webMounted)
    {
        Serial.println("Web app filesystem mount failed");
    }

    // Formats the store partition the first time, after a full erase.
    Serial.println("Mounting data filesystem...");
    bool dataMounted = DataFS.begin(true, "/data", 10, "store");
    if (!dataMounted)
    {
        Serial.println("Data filesystem mount failed");
    }

    return webMounted && dataMounted;
}
