#include "StripManager.h"

#include <RaptLaser.h>
#include <StripTracker.h>
#include <esp_timer.h>
#include <math.h>

#include "DeviceLog.h"
#include "ImageManager.h"
#include "LaserScanner.h"
#include "Storage.h"

// What the strip last showed, kept for after a restart: an Eco laser can be
// silent for hours, so the tap can't wait to hear it before drawing.
static const char* savedPath = "/strip.bin";
// Change it whenever Strip::Values changes, so an old file is ignored.
static const uint8_t savedVersion = 2;

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

// Test values from the web app, shown for 5 minutes so a tap is never left
// showing made-up numbers.
static const unsigned long testDuration = 5UL * 60 * 1000;
static bool testing = false;
static unsigned long testStartedAt = 0;
static Strip::Values testValues = {};

// Web requests arrive in the web server's task; the loop picks them up, so
// only the loop changes what the strip shows.
enum class TestRequest : uint8_t
{
    None,
    Show,
    Live,
};
static portMUX_TYPE testLock = portMUX_INITIALIZER_UNLOCKED;
static TestRequest testRequest = TestRequest::None;
static Strip::Values requestedValues = {};

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

// Starts or ends test values when the web app asks, or when time is up.
static void updateTest()
{
    portENTER_CRITICAL(&testLock);
    TestRequest request = testRequest;
    Strip::Values values = requestedValues;
    testRequest = TestRequest::None;
    portEXIT_CRITICAL(&testLock);

    if (request == TestRequest::Show)
    {
        testing = true;
        testStartedAt = millis();
        testValues = values;
        logEvent("test values", stripDescription(values));
        requestImageUpdate("test values");
        redrawRequested = true;
    }
    else if (testing && (request == TestRequest::Live || millis() - testStartedAt >= testDuration))
    {
        testing = false;
        logEvent("back to live", request == TestRequest::Live ? "asked for" : "after 5 minutes");
        requestImageUpdate("back to live");
        redrawRequested = true;
    }
}

void processStripManager()
{
    updateTest();

    unsigned long now = millis();
    if (now - lastPollAt < pollInterval)
    {
        return;
    }
    lastPollAt = now;

    poll();

    // While test values show, the laser's changes wait for going back to live.
    if (redrawRequested || testing)
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
    Strip::Values live = tracker.values(uptimeSeconds());

    if (!testing)
    {
        return live;
    }

    // The test numbers, with this tap's real laser dots and mode icon.
    Strip::Values values = testValues;
    values.laserChosen = true;
    values.laserNumber = live.laserNumber;
    values.mode = live.mode;
    values.test = true;
    return values;
}

void stripShown(const Strip::Values& values)
{
    redrawRequested = false;

    // The tracker and the saved values stay with the laser's values, so a
    // restart never brings test values back.
    if (values.test)
    {
        return;
    }

    tracker.shown(uptimeSeconds(), values);
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

    if (values.test)
    {
        text += ", test values";
    }

    return text;
}

bool clearStripValues()
{
    hasSaved = false;
    return removeDataFile(savedPath);
}

// A whole number in range, written plainly ("87").
static bool parseWhole(const String& text, long min, long max, long& value)
{
    if (text.isEmpty())
    {
        return false;
    }

    char* end = nullptr;
    long parsed = strtol(text.c_str(), &end, 10);
    if (*end != '\0' || parsed < min || parsed > max)
    {
        return false;
    }

    value = parsed;
    return true;
}

// A number in range ("18.3"), rounded to tenths. min and max are in tenths.
static bool parseTenths(const String& text, long min, long max, long& tenths)
{
    if (text.isEmpty())
    {
        return false;
    }

    char* end = nullptr;
    double parsed = strtod(text.c_str(), &end);
    long rounded = lround(parsed * 10);
    if (*end != '\0' || rounded < min || rounded > max)
    {
        return false;
    }

    tenths = rounded;
    return true;
}

bool showTestValues(
    const String& percent,
    const String& temperature,
    const String& battery,
    const String& modeWarning,
    const String& noSignal,
    String& error
)
{
    long percentValue = 0;
    long temperatureTenths = 0;
    long batteryValue = 0;

    if (!parseWhole(percent, 0, 100, percentValue))
    {
        error = "The percentage must be a whole number from 0 to 100.";
        return false;
    }

    if (!parseTenths(temperature, -200, 500, temperatureTenths))
    {
        error = "The temperature must be a number from -20 to 50.";
        return false;
    }

    if (!parseWhole(battery, 0, 100, batteryValue))
    {
        error = "The battery must be a whole number from 0 to 100.";
        return false;
    }

    Strip::Values values = {};
    values.laserChosen = true;
    values.hasLevel = true;
    values.percent = percentValue;
    // The litres of a full keg's percentage, rounded down like the laser's.
    values.litresTenths = RaptLaser::Corny19L.capacityTenthsLitres * percentValue / 100;
    values.hasTemperature = true;
    values.temperatureTenths = temperatureTenths;
    values.hasBattery = true;
    values.batteryPercent = batteryValue;
    values.modeWarning = modeWarning == "true";
    values.noSignal = noSignal == "true";

    portENTER_CRITICAL(&testLock);
    requestedValues = values;
    testRequest = TestRequest::Show;
    portEXIT_CRITICAL(&testLock);

    return true;
}

void showLiveValues()
{
    portENTER_CRITICAL(&testLock);
    testRequest = TestRequest::Live;
    portEXIT_CRITICAL(&testLock);
}

void addStripStatus(JsonObject strip)
{
    // Read from the web server's task; a moment out is fine for a countdown.
    bool showing = testing;
    unsigned long elapsed = millis() - testStartedAt;

    if (showing && elapsed < testDuration)
    {
        strip["testSecondsLeft"] = (testDuration - elapsed + 999) / 1000;
    }
    else
    {
        strip["testSecondsLeft"] = nullptr;
    }
}
