#include "StripManager.h"

#include <StripTracker.h>
#include <esp_timer.h>

#include "DeviceLog.h"
#include "ImageManager.h"
#include "LaserScanner.h"
#include "Storage.h"

// What the strip last showed, kept for after a restart: an Eco laser can be
// silent for hours, so the tap can't wait to hear it before drawing.
static const char* savedPath = "/strip.bin";
// Change it whenever Strip::Values changes, so an old file is ignored.
static const uint8_t savedVersion = 1;

struct SavedStrip
{
    uint8_t version;
    uint8_t address[6];
    Strip::Values values;
};

// How often to check the laser's readings
static const unsigned long pollInterval = 500;

static Strip::Tracker tracker;
static bool polled = false;
static bool lastChosen = false;
static uint8_t lastAddress[6] = {};
static uint32_t lastReadingCount = 0;
static unsigned long lastPollAt = 0;
// While a redraw the strip asked for hasn't happened yet
static bool redrawRequested = false;
static bool hasSaved = false;
static SavedStrip saved = {};

// Whole seconds since the tap started, which never wrap around like millis().
static int32_t uptimeSeconds()
{
    return static_cast<int32_t>(esp_timer_get_time() / 1000000);
}

// Passes the chosen laser and any new reading to the tracker.
static void poll()
{
    ChosenLaser laser = getChosenLaser();
    int32_t now = uptimeSeconds();
    bool newLaser =
        !polled ||
        laser.chosen != lastChosen ||
        memcmp(laser.address, lastAddress, sizeof(lastAddress)) != 0;

    polled = true;
    lastChosen = laser.chosen;
    memcpy(lastAddress, laser.address, sizeof(lastAddress));

    tracker.choose(
        now,
        laser.chosen,
        laser.address,
        laser.number,
        laser.eco ? Strip::Mode::Eco : Strip::Mode::Smart
    );

    if (!laser.chosen)
    {
        return;
    }

    if (laser.hasReading && (newLaser || laser.readingCount != lastReadingCount))
    {
        tracker.addReading(now, laser.reading);
    }
    lastReadingCount = laser.readingCount;

    if (laser.lastHeardAt != 0)
    {
        tracker.heard(now - static_cast<int32_t>((millis() - laser.lastHeardAt) / 1000));
    }
}

static bool loadSaved()
{
    // Checked first, because opening a missing file logs an error.
    if (!DataFS.exists(savedPath))
    {
        return false;
    }

    File file = DataFS.open(savedPath, "r");
    if (!file)
    {
        return false;
    }

    bool loaded =
        file.size() == sizeof(saved) &&
        file.read(reinterpret_cast<uint8_t*>(&saved), sizeof(saved)) == sizeof(saved) &&
        saved.version == savedVersion;
    file.close();

    return loaded;
}

static void save(const Strip::Values& values)
{
    if (
        hasSaved &&
        memcmp(saved.address, lastAddress, sizeof(lastAddress)) == 0 &&
        Strip::sameValues(saved.values, values)
    )
    {
        return;
    }

    SavedStrip next;
    memset(&next, 0, sizeof(next));
    next.version = savedVersion;
    memcpy(next.address, lastAddress, sizeof(next.address));
    next.values = values;

    File file = DataFS.open(savedPath, "w");
    bool written =
        file &&
        file.write(reinterpret_cast<const uint8_t*>(&next), sizeof(next)) == sizeof(next);
    if (file)
    {
        file.close();
    }

    if (!written)
    {
        removeDataFile(savedPath);
        hasSaved = false;
        logEvent("storage error", "unable to save the strip's values");
        return;
    }

    saved = next;
    hasSaved = true;
}

void startStripManager()
{
    poll();
    lastPollAt = millis();

    if (
        lastChosen &&
        loadSaved() &&
        saved.values.laserChosen &&
        memcmp(saved.address, lastAddress, sizeof(lastAddress)) == 0
    )
    {
        tracker.restore(uptimeSeconds(), saved.values);
        hasSaved = true;

        // Skipped if the screen already shows the saved image with this strip.
        requestImageUpdate("boot");
        redrawRequested = true;
    }

    // Otherwise the tracker asks for the first redraw once the laser is heard,
    // or after a minute without it.
}

void processStripManager()
{
    unsigned long now = millis();
    if (now - lastPollAt < pollInterval)
    {
        return;
    }
    lastPollAt = now;

    poll();

    if (redrawRequested)
    {
        return;
    }

    const char* reason = tracker.redrawReason(uptimeSeconds());
    if (reason)
    {
        requestImageUpdate(reason);
        redrawRequested = true;
    }
}

Strip::Values stripValues()
{
    poll();
    return tracker.values(uptimeSeconds());
}

void stripShown(const Strip::Values& values)
{
    tracker.shown(uptimeSeconds(), values);
    redrawRequested = false;
    save(values);
}

String stripDescription(const Strip::Values& values)
{
    if (!values.laserChosen)
    {
        return "no laser";
    }

    String text = values.hasLevel
        ? String(values.percent) + "%, " +
            String(values.litresTenths / 10) + "." + String(values.litresTenths % 10) + " L"
        : String("no reading");

    if (values.hasTemperature)
    {
        int tenths = abs(values.temperatureTenths);
        text += String(", ") + (values.temperatureTenths < 0 ? "-" : "") +
            String(tenths / 10) + "." + String(tenths % 10) + "°";
    }

    if (values.hasBattery)
    {
        text += ", battery " + String(values.batteryPercent) + "%";
    }

    if (values.noSignal)
    {
        text += ", no signal";
    }
    else if (values.modeWarning)
    {
        text += ", mode warning";
    }

    return text;
}

bool clearStripValues()
{
    hasSaved = false;
    return removeDataFile(savedPath);
}
