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
// No laser on purpose, last time the loop looked.
static bool lastNoLaser = false;
static bool hasSaved = false;
static SavedStrip saved = {};

// Test values from the web app, shown for 5 minutes so a tap is never left
// showing made-up numbers.
static const unsigned long testDuration = 5UL * 60 * 1000;
static bool testing = false;
static unsigned long testStartedAt = 0;
static Strip::Values testValues = {};
// The setup help screen shown in place of the picture meanwhile, or None.
static SetupHelp::Screen testHelp = SetupHelp::Screen::None;
// Whether the test shows test values in the strip. A test of no laser on
// purpose shows the setup help alone, on the whole screen.
static bool testStrip = false;

// Web requests arrive in the web server's task; the loop picks them up, so
// only the loop changes what the strip shows. The loop also publishes what the
// strip would show now, for the web app's preview. sharedLock guards these.
enum class TestRequest : uint8_t
{
    None,
    Show,
    Live,
    // A new laser choice: ends the test without a redraw of its own.
    LaserChosen,
};
static portMUX_TYPE sharedLock = portMUX_INITIALIZER_UNLOCKED;
static TestRequest testRequest = TestRequest::None;
static Strip::Values requestedValues = {};
static SetupHelp::Screen requestedHelp = SetupHelp::Screen::None;
static bool requestedStrip = false;
static Strip::Values publishedValues = {};

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
    lastNoLaser = noLaserOnPurpose();

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

static Strip::Values currentValues();

// Starts or ends test values when the web app asks, or when time is up.
static void updateTest()
{
    portENTER_CRITICAL(&sharedLock);
    TestRequest request = testRequest;
    Strip::Values values = requestedValues;
    SetupHelp::Screen help = requestedHelp;
    bool strip = requestedStrip;
    testRequest = TestRequest::None;
    portEXIT_CRITICAL(&sharedLock);

    if (request == TestRequest::Show)
    {
        testing = true;
        testStartedAt = millis();
        testValues = values;
        testHelp = help;
        testStrip = strip;
        String helpName = help == SetupHelp::Screen::JoinWifi ? "join" : "ready";
        if (strip)
        {
            logEvent(
                "test values",
                stripDescription(values) +
                    (help == SetupHelp::Screen::None ? String() : ", setup help " + helpName)
            );
        }
        else
        {
            logEvent("setup help test", helpName);
        }
        requestImageUpdate(strip ? "test values" : "setup help test");
        redrawRequested = true;
    }
    else if (testing && request == TestRequest::LaserChosen)
    {
        // The strip's redraw rules show the new choice: once its first reading
        // arrives (within a minute) for a laser, or straight away for none.
        testing = false;
        testHelp = SetupHelp::Screen::None;
        testStrip = false;
        redrawRequested = false;
        logEvent("back to live", "laser chosen");
    }
    else if (testing && (request == TestRequest::Live || millis() - testStartedAt >= testDuration))
    {
        testing = false;
        testHelp = SetupHelp::Screen::None;
        testStrip = false;
        logEvent("back to live", request == TestRequest::Live ? "asked for" : "after 5 minutes");
        requestImageUpdate("back to live");
        redrawRequested = true;
    }
}

// The tracker redraws for a new laser, or for none after a laser, but can't tell
// no laser on purpose (the whole screen) from none chosen yet (the strip asking
// for one), so a change between those two redraws here.
static void watchNoLaser()
{
    bool noLaser = noLaserOnPurpose();
    if (noLaser == lastNoLaser)
    {
        return;
    }

    lastNoLaser = noLaser;
    if (!lastChosen && !testing)
    {
        requestImageUpdate("no laser");
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
    watchNoLaser();

    Strip::Values current = currentValues();
    portENTER_CRITICAL(&sharedLock);
    publishedValues = current;
    portEXIT_CRITICAL(&sharedLock);

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

// The tracker's values, or test values while they show. The caller polls first.
static Strip::Values currentValues()
{
    Strip::Values live = tracker.values(uptimeSeconds());

    if (!testing || !testStrip)
    {
        return live;
    }

    // The test numbers, with the tested laser's dots and mode icon.
    Strip::Values values = testValues;
    values.test = true;
    return values;
}

Strip::Values stripValues()
{
    poll();
    return currentValues();
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

// For the loop to pick up.
static void requestTestValues(const Strip::Values& values, SetupHelp::Screen setupHelp)
{
    portENTER_CRITICAL(&sharedLock);
    requestedValues = values;
    requestedHelp = setupHelp;
    requestedStrip = true;
    testRequest = TestRequest::Show;
    portEXIT_CRITICAL(&sharedLock);
}

bool showTestValues(
    const String& percent,
    const String& litres,
    const String& temperature,
    const String& battery,
    const String& modeWarning,
    const String& noSignal,
    const String& noReading,
    const TestLaser& laser,
    SetupHelp::Screen setupHelp,
    String& error
)
{
    if (laser.noLaser)
    {
        error = "With no laser, there's no strip to test.";
        return false;
    }

    Strip::Values values = {};
    values.laserChosen = true;
    values.laserNumber = laser.number;
    values.mode = laser.eco ? Strip::Mode::Eco : Strip::Mode::Smart;
    values.modeWarning = modeWarning == "true";
    values.noSignal = noSignal == "true";

    if (noReading == "true")
    {
        requestTestValues(values, setupHelp);
        return true;
    }

    long percentValue = 0;
    long litresTenths = 0;
    long temperatureTenths = 0;
    long batteryValue = 0;
    const long kegTenths = RaptLaser::Corny19L.capacityTenthsLitres;

    if (!parseWhole(percent, 0, 100, percentValue))
    {
        error = "The percentage must be a whole number from 0 to 100.";
        return false;
    }

    if (litres.isEmpty())
    {
        // The litres of a full keg's percentage, rounded down like the laser's.
        litresTenths = kegTenths * percentValue / 100;
    }
    else if (!parseTenths(litres, 0, kegTenths, litresTenths))
    {
        error = "The litres must be a number from 0 to 19.";
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

    values.hasLevel = true;
    values.percent = percentValue;
    values.litresTenths = litresTenths;
    values.hasTemperature = true;
    values.temperatureTenths = temperatureTenths;
    values.hasBattery = true;
    values.batteryPercent = batteryValue;
    requestTestValues(values, setupHelp);

    return true;
}

void showSetupHelpTest(SetupHelp::Screen screen)
{
    portENTER_CRITICAL(&sharedLock);
    requestedValues = {};
    requestedHelp = screen;
    requestedStrip = false;
    testRequest = TestRequest::Show;
    portEXIT_CRITICAL(&sharedLock);
}

SetupHelp::Screen testSetupHelp()
{
    return testing ? testHelp : SetupHelp::Screen::None;
}

bool pictureFillsScreen()
{
    return testing ? !testStrip : noLaserOnPurpose();
}

void endTestForLaserChoice()
{
    portENTER_CRITICAL(&sharedLock);
    testRequest = TestRequest::LaserChosen;
    portEXIT_CRITICAL(&sharedLock);
}

void showLiveValues()
{
    portENTER_CRITICAL(&sharedLock);
    testRequest = TestRequest::Live;
    portEXIT_CRITICAL(&sharedLock);
}

void addStripStatus(JsonObject strip)
{
    portENTER_CRITICAL(&sharedLock);
    Strip::Values values = publishedValues;
    portEXIT_CRITICAL(&sharedLock);

    // The same names as app/web/src/strip.ts. Values not known yet are null.
    JsonObject shown = strip["values"].to<JsonObject>();
    shown["laserChosen"] = values.laserChosen;
    shown["laserNumber"] = values.laserNumber;
    shown["mode"] = values.mode == Strip::Mode::Eco ? "eco" : "smart";
    if (values.hasLevel)
    {
        shown["percent"] = values.percent;
        shown["litresTenths"] = values.litresTenths;
    }
    else
    {
        shown["percent"] = nullptr;
        shown["litresTenths"] = nullptr;
    }
    if (values.hasTemperature)
    {
        shown["temperatureTenths"] = values.temperatureTenths;
    }
    else
    {
        shown["temperatureTenths"] = nullptr;
    }
    if (values.hasBattery)
    {
        shown["batteryPercent"] = values.batteryPercent;
    }
    else
    {
        shown["batteryPercent"] = nullptr;
    }
    shown["modeWarning"] = values.modeWarning;
    shown["noSignal"] = values.noSignal;
    shown["test"] = values.test;

    // The laser chosen, so the web app's preview keeps up with a choice made
    // from another page.
    addChosenLaser(strip);

    // Read from the web server's task; a moment out is fine for a countdown.
    bool showing = testing;
    SetupHelp::Screen help = testHelp;
    unsigned long elapsed = millis() - testStartedAt;

    if (showing && elapsed < testDuration)
    {
        strip["testSecondsLeft"] = (testDuration - elapsed + 999) / 1000;
    }
    else
    {
        strip["testSecondsLeft"] = nullptr;
    }

    if (showing && help != SetupHelp::Screen::None)
    {
        strip["setupHelp"] = help == SetupHelp::Screen::JoinWifi ? "join" : "ready";
    }
    else
    {
        strip["setupHelp"] = nullptr;
    }
}
