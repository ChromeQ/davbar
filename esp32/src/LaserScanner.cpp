#include "LaserScanner.h"

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <RaptLaser.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "DeviceLog.h"

// The radio is shared with WiFi, so it listens for half of each 100 ms. The
// catch rate tests in step 3 check this is enough.
static const uint16_t scanIntervalMs = 100;
static const uint16_t scanWindowMs = 50;

static const size_t maxLasers = 8;
static const unsigned long summaryInterval = 5UL * 60 * 1000;
// Live Stream sends a new reading every second; log at most one per 10s.
static const unsigned long minLogInterval = 10000;
static const unsigned long scanCheckInterval = 10000;

struct LaserState
{
    uint8_t address[6];
    // The latest broadcast with a distance. Empty broadcasts don't replace it.
    bool hasReading;
    RaptLaser::Reading reading;
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

// Broadcasts arrive in the Bluetooth task, while the loop and web requests read
// the lasers, so they are guarded by a mutex.
static SemaphoreHandle_t lasersMutex = nullptr;
static LaserState lasers[maxLasers];
static size_t laserCount = 0;
// Broadcasts from any device since the last summary, lasers or not. None at all
// means Bluetooth isn't getting any time on the radio.
static std::atomic<uint32_t> broadcastsHeard{0};
static unsigned long lastSummaryAt = 0;
static unsigned long lastScanCheckAt = 0;
static uint8_t pausedFor = 0;

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

    return addressText(laser.address) +
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

    lastSummaryAt = millis();
    lastScanCheckAt = millis();

    startScan();
    logEvent("laser scan started");
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

        summary += addressText(laser.address) + " ";

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

    xSemaphoreGive(lasersMutex);

    if (summary.isEmpty())
    {
        summary = "no lasers heard yet; ";
    }

    summary +=
        String(broadcastsHeard.exchange(0)) + " broadcasts from any device; " +
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
        const LaserState& laser = lasers[i];
        JsonObject item = list.add<JsonObject>();

        item["address"] = addressText(laser.address);
        item["rssi"] = laser.rssi;
        item["lastHeardSeconds"] = (now - laser.lastHeardAt) / 1000;

        if (!laser.hasReading)
        {
            item["reading"] = nullptr;
            continue;
        }

        const RaptLaser::Reading& reading = laser.reading;
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

    xSemaphoreGive(lasersMutex);
}
