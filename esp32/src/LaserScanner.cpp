#include "LaserScanner.h"

#include <NimBLEDevice.h>
#include <RaptLaser.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "DeviceConfig.h"
#include "DeviceLog.h"
#include "Settings.h"

// The radio is shared with WiFi, so it listens for half of each 100 ms. The
// catch rate tests in step 3 check this is enough.
static const uint16_t scanIntervalMs = 100;
static const uint16_t scanWindowMs = 50;

static const size_t maxLasers = 8;
static const unsigned long summaryInterval = 5UL * 60 * 1000;
// Live Stream sends a new reading every second; log at most one per 10s.
static const unsigned long minLogInterval = 10000;
static const unsigned long scanCheckInterval = 10000;
// How long each laser list request listens to every laser. The picker asks
// every few seconds while it's open, and a laser answers about every 15s.
static const unsigned long searchDuration = 60000;

struct LaserState
{
    uint8_t address[6];
    // The latest broadcast with a distance. Empty broadcasts don't replace it.
    bool hasReading;
    RaptLaser::Reading reading;
    // Counts new readings, so the strip can tell when there's another.
    uint32_t readingCount;
    int8_t rssi;
    unsigned long lastHeardAt;
    bool readingChanged;
    unsigned long lastLoggedAt;
    RaptLaser::Mode loggedMode;
    // Since the last 5-minute summary
    uint32_t heard;
    int8_t weakestRssi;
    int8_t strongestRssi;
    unsigned long longestGapMs;
};

// The mode this tap expects its laser to be in, chosen in the web app.
enum class ChosenMode : uint8_t
{
    Smart,
    Eco,
};

// Broadcasts arrive in the Bluetooth task and choices in web requests, while
// the loop and web requests read them, so all of this is guarded by a mutex.
static SemaphoreHandle_t lasersMutex = nullptr;
static LaserState lasers[maxLasers];
static size_t laserCount = 0;
static bool laserChosen = false;
// No laser on purpose, saved as "none", rather than none chosen yet.
static bool noLaser = false;
static uint8_t chosenAddress[6];
static ChosenMode chosenMode = ChosenMode::Smart;
// Every laser is asked for readings until this time (millis); 0 when not.
static unsigned long searchUntil = 0;
// Set when the choice changes, so the loop updates the scan.
static bool choiceChanged = false;

// Broadcasts from any device since the last summary, lasers or not. None at all
// means Bluetooth isn't getting any time on the radio.
static std::atomic<uint32_t> broadcastsHeard{0};

// Used only by the loop
static unsigned long lastSummaryAt = 0;
static unsigned long lastScanCheckAt = 0;
static uint8_t pausedFor = 0;
// Whether the scan asks only the chosen laser, and whether that failed to set
// up (then every laser is asked until the choice changes).
static bool scanFiltered = false;
static bool filterFailed = false;

static bool sameReading(const RaptLaser::Reading& a, const RaptLaser::Reading& b)
{
    return a.distanceMm == b.distanceMm &&
        a.hasBattery == b.hasBattery &&
        a.batteryTenthsPercent == b.batteryTenthsPercent &&
        a.hasTemperature == b.hasTemperature &&
        a.temperatureHundredthsC == b.temperatureHundredthsC &&
        a.mode == b.mode;
}

// The caller holds lasersMutex. Returns null when the list is full.
static LaserState* findOrAddLaser(const uint8_t address[6])
{
    for (size_t i = 0; i < laserCount; i++)
    {
        if (memcmp(lasers[i].address, address, sizeof(lasers[i].address)) == 0)
        {
            return &lasers[i];
        }
    }

    if (laserCount == maxLasers)
    {
        return nullptr;
    }

    LaserState* laser = &lasers[laserCount++];
    *laser = {};
    memcpy(laser->address, address, sizeof(laser->address));

    return laser;
}

// The caller holds lasersMutex. Returns null for a laser not heard yet.
static const LaserState* findLaser(const uint8_t address[6])
{
    for (size_t i = 0; i < laserCount; i++)
    {
        if (memcmp(lasers[i].address, address, sizeof(lasers[i].address)) == 0)
        {
            return &lasers[i];
        }
    }

    return nullptr;
}

class ScanCallbacks : public NimBLEScanCallbacks
{
    void onResult(const NimBLEAdvertisedDevice* device) override
    {
        broadcastsHeard++;

        if (device->getManufacturerDataCount() == 0)
        {
            return;
        }

        std::string data = device->getManufacturerData();
        RaptLaser::Reading reading;
        if (!RaptLaser::decodeManufacturerData(
            reinterpret_cast<const uint8_t*>(data.data()),
            data.size(),
            reading
        ))
        {
            return;
        }

        unsigned long now = millis();
        int8_t rssi = device->getRSSI();

        xSemaphoreTake(lasersMutex, portMAX_DELAY);

        LaserState* laser = findOrAddLaser(reading.address);
        if (laser)
        {
            if (laser->lastHeardAt != 0 && now - laser->lastHeardAt > laser->longestGapMs)
            {
                laser->longestGapMs = now - laser->lastHeardAt;
            }

            if (laser->heard == 0 || rssi < laser->weakestRssi)
            {
                laser->weakestRssi = rssi;
            }

            if (laser->heard == 0 || rssi > laser->strongestRssi)
            {
                laser->strongestRssi = rssi;
            }

            laser->heard++;
            laser->rssi = rssi;
            laser->lastHeardAt = now;

            if (reading.hasDistance && (!laser->hasReading || !sameReading(reading, laser->reading)))
            {
                laser->hasReading = true;
                laser->reading = reading;
                laser->readingCount++;
                laser->readingChanged = true;
            }
        }

        xSemaphoreGive(lasersMutex);
    }
};

static ScanCallbacks scanCallbacks;

static String addressText(const uint8_t address[6])
{
    char text[18];
    RaptLaser::formatAddress(address, text);

    return text;
}

// The laser's number in config/lasers.json, or 0 for a laser not in it.
static uint8_t laserNumber(const uint8_t address[6])
{
    for (const DeviceConfig::Laser& known : DeviceConfig::Lasers)
    {
        uint8_t knownAddress[6];
        if (
            RaptLaser::parseAddress(known.address, knownAddress) &&
            memcmp(knownAddress, address, sizeof(knownAddress)) == 0
        )
        {
            return known.number;
        }
    }

    return 0;
}

// "laser 2 (C4:A3:DF:A2:C5:1B)", or just the address for a laser not in the list
static String laserName(const uint8_t address[6])
{
    uint8_t number = laserNumber(address);
    if (number == 0)
    {
        return addressText(address);
    }

    return "laser " + String(number) + " (" + addressText(address) + ")";
}

static const char* modeText(ChosenMode mode)
{
    return mode == ChosenMode::Eco ? "eco" : "smart";
}

static bool parseMode(const String& text, ChosenMode& mode)
{
    if (text == "smart")
    {
        mode = ChosenMode::Smart;
        return true;
    }

    if (text == "eco")
    {
        mode = ChosenMode::Eco;
        return true;
    }

    return false;
}

static String litresText(uint16_t litresTenths)
{
    return String(litresTenths / 10) + "." + String(litresTenths % 10) + " L";
}

static String batteryText(const RaptLaser::Reading& reading)
{
    if (!reading.hasBattery)
    {
        return "missing";
    }

    return String(reading.batteryTenthsPercent / 10) + "." + String(reading.batteryTenthsPercent % 10) + "%";
}

static String temperatureText(const RaptLaser::Reading& reading)
{
    if (!reading.hasTemperature)
    {
        return "missing";
    }

    return String(reading.temperatureHundredthsC / 100.0, 2) + " °C";
}

// The caller holds lasersMutex.
static String readingDetails(const LaserState& laser)
{
    const RaptLaser::Reading& reading = laser.reading;
    RaptLaser::KegLevel level = RaptLaser::kegLevel(reading.distanceMm);

    return laserName(laser.address) +
        ", " + String(reading.distanceMm) + " mm" +
        ", " + litresText(level.litresTenths) +
        ", " + String(level.percent) + "%" +
        ", " + RaptLaser::modeName(reading.mode) +
        ", battery " + batteryText(reading) +
        ", " + temperatureText(reading) +
        ", signal " + String(laser.rssi) + " dBm";
}

static void startScan()
{
    NimBLEScan* scan = NimBLEDevice::getScan();
    if (!scan->start(0, false, true))
    {
        logEvent("laser scan failed to start");
    }
}

// Makes the scan ask only the given laser (the controller's accept list), or
// every laser. The list can only change while the scan is stopped, so this
// stops it; the caller starts it again. Returns false if the list can't be set.
static bool filterScan(bool filtered, const uint8_t address[6])
{
    NimBLEScan* scan = NimBLEDevice::getScan();
    if (scan->isScanning())
    {
        scan->stop();
    }

    while (NimBLEDevice::getWhiteListCount() > 0)
    {
        if (!NimBLEDevice::whiteListRemove(NimBLEDevice::getWhiteListAddress(0)))
        {
            filtered = false;
            break;
        }
    }

    bool listed = true;
    if (filtered)
    {
        // RAPT lasers use random static addresses. The public kind is added
        // too, in case another RAPT sensor doesn't.
        listed =
            NimBLEDevice::whiteListAdd(NimBLEAddress(address, BLE_ADDR_RANDOM)) &&
            NimBLEDevice::whiteListAdd(NimBLEAddress(address, BLE_ADDR_PUBLIC));
    }

    scanFiltered = filtered && listed;
    scan->setFilterPolicy(scanFiltered ? BLE_HCI_SCAN_FILT_USE_WL : BLE_HCI_SCAN_FILT_NO_WL);

    return listed;
}

// Asks only the chosen laser, except while the picker is searching. Called
// from the loop, because the Bluetooth calls aren't safe from web requests.
static void updateScanFilter()
{
    unsigned long now = millis();
    uint8_t address[6];

    xSemaphoreTake(lasersMutex, portMAX_DELAY);

    if (searchUntil != 0 && static_cast<long>(now - searchUntil) >= 0)
    {
        searchUntil = 0;
    }

    bool filtered = laserChosen && searchUntil == 0;
    bool changed = choiceChanged;
    choiceChanged = false;
    memcpy(address, chosenAddress, sizeof(address));

    xSemaphoreGive(lasersMutex);

    if (changed)
    {
        filterFailed = false;
    }

    filtered = filtered && !filterFailed;

    // A different laser needs the list rewritten even if filtering stays on.
    if (filtered == scanFiltered && !(changed && filtered))
    {
        return;
    }

    if (!filterScan(filtered, address))
    {
        filterFailed = true;
        logEvent("laser filter failed", "asking every laser instead");
        filterScan(false, address);
    }

    if (pausedFor == 0)
    {
        startScan();
        lastScanCheckAt = millis();
    }
}

void startLaserScanner()
{
    lasersMutex = xSemaphoreCreateMutex();

    NimBLEDevice::init("");

    NimBLEScan* scan = NimBLEDevice::getScan();
    // Report every broadcast, including repeats, and keep none in memory: each
    // one is handled in the callback.
    scan->setScanCallbacks(&scanCallbacks, true);
    scan->setDuplicateFilter(false);
    scan->setMaxResults(0);
    // Active: in Smart mode a laser's broadcast holds only its service ID; the
    // reading comes in the scan response, sent only when asked for.
    scan->setActiveScan(true);
    scan->setInterval(scanIntervalMs);
    scan->setWindow(scanWindowMs);

    String address;
    String mode;
    String choice = "no laser chosen";
    bool saved = loadLaserSettings(address, mode);
    if (saved && address == "none")
    {
        noLaser = true;
        choice = "no laser, on purpose";
    }
    else if (saved && RaptLaser::parseAddress(address.c_str(), chosenAddress))
    {
        laserChosen = true;
        parseMode(mode, chosenMode);
        choice = laserName(chosenAddress) + ", " + modeText(chosenMode);

        if (!filterScan(true, chosenAddress))
        {
            filterFailed = true;
            filterScan(false, chosenAddress);
        }
    }

    lastSummaryAt = millis();
    lastScanCheckAt = millis();

    startScan();
    logEvent("laser scan started", choice);
}

static void logChangedReadings()
{
    unsigned long now = millis();
    String entries[maxLasers];
    size_t entryCount = 0;

    xSemaphoreTake(lasersMutex, portMAX_DELAY);

    for (size_t i = 0; i < laserCount; i++)
    {
        LaserState& laser = lasers[i];
        if (!laser.readingChanged)
        {
            continue;
        }

        bool modeChanged = laser.reading.mode != laser.loggedMode;
        if (!modeChanged && laser.lastLoggedAt != 0 && now - laser.lastLoggedAt < minLogInterval)
        {
            continue;
        }

        entries[entryCount++] = readingDetails(laser);
        laser.readingChanged = false;
        laser.lastLoggedAt = now;
        laser.loggedMode = laser.reading.mode;
    }

    xSemaphoreGive(lasersMutex);

    // Logged outside the mutex, so the Bluetooth task isn't kept waiting.
    for (size_t i = 0; i < entryCount; i++)
    {
        logEvent("laser reading", entries[i]);
    }
}

static void logSummary()
{
    unsigned long now = millis();
    String summary;

    xSemaphoreTake(lasersMutex, portMAX_DELAY);

    for (size_t i = 0; i < laserCount; i++)
    {
        LaserState& laser = lasers[i];
        bool chosen = laserChosen && memcmp(laser.address, chosenAddress, sizeof(chosenAddress)) == 0;

        // Once a laser is chosen, the others are only heard while searching.
        if (laser.heard == 0 && laserChosen && !chosen)
        {
            continue;
        }

        summary += laserName(laser.address) + " ";

        if (laser.heard == 0)
        {
            summary += "not heard for " + String((now - laser.lastHeardAt) / 60000) + " min";
        }
        else
        {
            summary +=
                String(laser.heard) + " heard" +
                ", signal " + String(laser.weakestRssi) + " to " + String(laser.strongestRssi) + " dBm" +
                ", longest gap " + String(laser.longestGapMs / 1000) + " s";
        }

        summary += "; ";

        laser.heard = 0;
        laser.longestGapMs = 0;
    }

    bool chosenHeard = !laserChosen || findLaser(chosenAddress) != nullptr;
    String chosenName = laserChosen ? laserName(chosenAddress) : String();

    xSemaphoreGive(lasersMutex);

    if (!chosenHeard)
    {
        summary = chosenName + " not heard yet; " + summary;
    }

    if (summary.isEmpty())
    {
        summary = "no lasers heard yet; ";
    }

    // While only the chosen laser is asked, the controller passes on nothing
    // else, so an Eco laser's silence makes this 0.
    summary += String(broadcastsHeard.exchange(0)) +
        (scanFiltered ? " broadcasts (only the chosen laser is asked); " : " broadcasts from any device; ");

    summary +=
        "free memory " + String(ESP.getFreeHeap() / 1024) + " KB" +
        " (lowest " + String(ESP.getMinFreeHeap() / 1024) + " KB)";

    logEvent("lasers heard", summary);
}

void processLaserScanner()
{
    if (!lasersMutex)
    {
        return;
    }

    updateScanFilter();

    logChangedReadings();

    unsigned long now = millis();

    if (now - lastSummaryAt >= summaryInterval)
    {
        lastSummaryAt = now;
        logSummary();
    }

    if (pausedFor == 0 && now - lastScanCheckAt >= scanCheckInterval)
    {
        lastScanCheckAt = now;

        if (!NimBLEDevice::getScan()->isScanning())
        {
            logEvent("laser scan stopped, restarting it");
            startScan();
        }
    }
}

void pauseLaserScanner(ScanPause reason)
{
    uint8_t bit = static_cast<uint8_t>(reason);
    if (!lasersMutex || (pausedFor & bit))
    {
        return;
    }

    if (pausedFor == 0)
    {
        NimBLEDevice::getScan()->stop();
    }

    pausedFor |= bit;

    // Pauses for WiFi happen every 30s while offline, so only updates are logged.
    if (reason == ScanPause::Update)
    {
        logEvent("laser scan paused", "update");
    }
}

void resumeLaserScanner(ScanPause reason)
{
    uint8_t bit = static_cast<uint8_t>(reason);
    if (!lasersMutex || !(pausedFor & bit))
    {
        return;
    }

    pausedFor &= ~bit;

    if (pausedFor == 0)
    {
        startScan();
        lastScanCheckAt = millis();
    }

    if (reason == ScanPause::Update)
    {
        logEvent("laser scan resumed");
    }
}

// A choice as chooseLaser takes it.
struct LaserChoice
{
    // An empty address, which forgets the choice
    bool forget;
    // "none"
    bool onPurpose;
    uint8_t address[6];
    ChosenMode mode;
};

static bool parseLaserChoice(
    const String& address,
    const String& mode,
    LaserChoice& choice,
    String& error
)
{
    choice = {};
    choice.forget = address.isEmpty();
    choice.onPurpose = address == "none";
    choice.mode = ChosenMode::Smart;

    if (
        !choice.forget &&
        !choice.onPurpose &&
        !RaptLaser::parseAddress(address.c_str(), choice.address)
    )
    {
        error = "That isn't a laser address, such as E5:4C:66:F9:E1:33.";
        return false;
    }

    if (!mode.isEmpty() && !parseMode(mode, choice.mode))
    {
        error = "The mode must be smart or eco.";
        return false;
    }

    return true;
}

bool checkLaserChoice(const String& address, const String& mode, bool& changes, String& error)
{
    if (!lasersMutex)
    {
        error = "Bluetooth hasn't started yet. Try again.";
        return false;
    }

    LaserChoice choice;
    if (!parseLaserChoice(address, mode, choice, error))
    {
        return false;
    }

    bool none = choice.forget || choice.onPurpose;

    xSemaphoreTake(lasersMutex, portMAX_DELAY);
    // No laser has no mode to compare.
    changes =
        laserChosen == none ||
        noLaser != choice.onPurpose ||
        (
            !none &&
            (
                memcmp(chosenAddress, choice.address, sizeof(chosenAddress)) != 0 ||
                chosenMode != choice.mode
            )
        );
    xSemaphoreGive(lasersMutex);

    return true;
}

bool readTestLaser(const String& address, const String& mode, TestLaser& laser, String& error)
{
    laser = {};

    if (!lasersMutex)
    {
        error = "Bluetooth hasn't started yet. Try again.";
        return false;
    }

    if (address.isEmpty())
    {
        xSemaphoreTake(lasersMutex, portMAX_DELAY);
        laser.noLaser = noLaser;
        laser.number = laserChosen ? laserNumber(chosenAddress) : 0;
        laser.eco = laserChosen && chosenMode == ChosenMode::Eco;
        xSemaphoreGive(lasersMutex);

        return true;
    }

    LaserChoice choice;
    if (!parseLaserChoice(address, mode, choice, error))
    {
        return false;
    }

    laser.noLaser = choice.onPurpose;
    laser.number = choice.onPurpose ? 0 : laserNumber(choice.address);
    laser.eco = !choice.onPurpose && choice.mode == ChosenMode::Eco;

    return true;
}

bool chooseLaser(const String& address, const String& mode, String& error)
{
    if (!lasersMutex)
    {
        error = "Bluetooth hasn't started yet. Try again.";
        return false;
    }

    LaserChoice choice;
    if (!parseLaserChoice(address, mode, choice, error))
    {
        return false;
    }

    bool forget = choice.forget;
    bool onPurpose = choice.onPurpose;
    bool none = forget || onPurpose;
    const uint8_t* parsed = choice.address;
    ChosenMode parsedMode = choice.mode;

    // Saved with capital letters, however it was typed
    bool saved = forget ? clearLaserSettings()
        : onPurpose     ? saveLaserSettings("none", "smart")
                        : saveLaserSettings(addressText(parsed), modeText(parsedMode));
    if (!saved)
    {
        error = "Unable to save the laser. Try again.";
        return false;
    }

    xSemaphoreTake(lasersMutex, portMAX_DELAY);
    laserChosen = !none;
    noLaser = onPurpose;
    memcpy(chosenAddress, parsed, sizeof(chosenAddress));
    chosenMode = parsedMode;
    choiceChanged = true;
    xSemaphoreGive(lasersMutex);

    logEvent(
        "laser chosen",
        onPurpose ? String("none, on purpose")
            : forget ? String("none")
                     : laserName(parsed) + ", " + modeText(parsedMode)
    );

    return true;
}

bool clearLaserChoice()
{
    if (!clearLaserSettings())
    {
        return false;
    }

    if (lasersMutex)
    {
        xSemaphoreTake(lasersMutex, portMAX_DELAY);
        laserChosen = false;
        noLaser = false;
        choiceChanged = true;
        xSemaphoreGive(lasersMutex);
    }

    return true;
}

bool noLaserOnPurpose()
{
    if (!lasersMutex)
    {
        return false;
    }

    xSemaphoreTake(lasersMutex, portMAX_DELAY);
    bool result = noLaser;
    xSemaphoreGive(lasersMutex);
    return result;
}

// The caller holds lasersMutex.
static void addChosenLaserLocked(JsonObject response)
{
    response["noLaser"] = noLaser;

    if (!laserChosen)
    {
        response["laser"] = nullptr;
        return;
    }

    JsonObject laser = response["laser"].to<JsonObject>();
    uint8_t number = laserNumber(chosenAddress);

    if (number == 0)
    {
        laser["number"] = nullptr;
    }
    else
    {
        laser["number"] = number;
    }

    laser["address"] = addressText(chosenAddress);
    laser["mode"] = modeText(chosenMode);
}

void addChosenLaser(JsonObject response)
{
    if (!lasersMutex)
    {
        response["laser"] = nullptr;
        return;
    }

    xSemaphoreTake(lasersMutex, portMAX_DELAY);
    addChosenLaserLocked(response);
    xSemaphoreGive(lasersMutex);
}

ChosenLaser getChosenLaser()
{
    ChosenLaser result = {};
    if (!lasersMutex)
    {
        return result;
    }

    xSemaphoreTake(lasersMutex, portMAX_DELAY);

    if (laserChosen)
    {
        result.chosen = true;
        memcpy(result.address, chosenAddress, sizeof(result.address));
        result.number = laserNumber(chosenAddress);
        result.eco = chosenMode == ChosenMode::Eco;

        const LaserState* laser = findLaser(chosenAddress);
        if (laser)
        {
            result.lastHeardAt = laser->lastHeardAt;
            result.hasReading = laser->hasReading;
            result.reading = laser->reading;
            result.readingCount = laser->readingCount;
        }
    }

    xSemaphoreGive(lasersMutex);

    return result;
}

// The caller holds lasersMutex. A laser not heard yet has nulls.
static void addLaserItem(JsonArray list, const uint8_t address[6], const LaserState* laser, unsigned long now)
{
    JsonObject item = list.add<JsonObject>();
    uint8_t number = laserNumber(address);

    if (number == 0)
    {
        item["number"] = nullptr;
    }
    else
    {
        item["number"] = number;
    }

    item["address"] = addressText(address);

    if (!laser)
    {
        item["rssi"] = nullptr;
        item["lastHeardSeconds"] = nullptr;
        item["reading"] = nullptr;
        return;
    }

    item["rssi"] = laser->rssi;
    item["lastHeardSeconds"] = (now - laser->lastHeardAt) / 1000;

    if (!laser->hasReading)
    {
        item["reading"] = nullptr;
        return;
    }

    const RaptLaser::Reading& reading = laser->reading;
    RaptLaser::KegLevel level = RaptLaser::kegLevel(reading.distanceMm);
    JsonObject details = item["reading"].to<JsonObject>();

    details["mode"] = RaptLaser::modeName(reading.mode);
    details["distanceMm"] = reading.distanceMm;
    details["litres"] = level.litresTenths / 10.0;
    details["percent"] = level.percent;

    if (reading.hasBattery)
    {
        details["batteryPercent"] = reading.batteryTenthsPercent / 10.0;
    }
    else
    {
        details["batteryPercent"] = nullptr;
    }

    if (reading.hasTemperature)
    {
        details["temperatureC"] = reading.temperatureHundredthsC / 100.0;
    }
    else
    {
        details["temperatureC"] = nullptr;
    }
}

void addLaserStatus(JsonArray list)
{
    if (!lasersMutex)
    {
        return;
    }

    unsigned long now = millis();

    xSemaphoreTake(lasersMutex, portMAX_DELAY);

    for (size_t i = 0; i < laserCount; i++)
    {
        addLaserItem(list, lasers[i].address, &lasers[i], now);
    }

    xSemaphoreGive(lasersMutex);
}

void addLaserList(JsonObject response)
{
    if (!lasersMutex)
    {
        response["laser"] = nullptr;
        response["lasers"].to<JsonArray>();
        return;
    }

    unsigned long now = millis();
    JsonArray list = response["lasers"].to<JsonArray>();

    xSemaphoreTake(lasersMutex, portMAX_DELAY);

    bool searchStarting = laserChosen && searchUntil == 0;
    // Never 0, which means not searching
    searchUntil = (now + searchDuration) | 1;

    addChosenLaserLocked(response);

    for (const DeviceConfig::Laser& known : DeviceConfig::Lasers)
    {
        uint8_t address[6];
        if (RaptLaser::parseAddress(known.address, address))
        {
            addLaserItem(list, address, findLaser(address), now);
        }
    }

    for (size_t i = 0; i < laserCount; i++)
    {
        if (laserNumber(lasers[i].address) == 0)
        {
            addLaserItem(list, lasers[i].address, &lasers[i], now);
        }
    }

    xSemaphoreGive(lasersMutex);

    if (searchStarting)
    {
        logEvent("laser search", "asking every laser for a minute");
    }
}
