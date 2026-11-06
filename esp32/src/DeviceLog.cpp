#include "DeviceLog.h"

#include <esp32s3/rom/rtc.h>
#include <esp_ota_ops.h>
#include <esp_sntp.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <time.h>

#include <algorithm>
#include <memory>
#include <vector>

#include "Storage.h"

// The log is a set of numbered CSV segments, oldest dropped first: 16 x 64 KB
// keeps it within 1 MB.
static const char* logDirectory = "/log";
static const size_t maxSegmentSize = 64 * 1024;
static const size_t maxSegments = 16;
static const char* csvHeader = "time,uptime_s,event,details\n";

static const unsigned long flushInterval = 5UL * 60 * 1000;
static const size_t flushThreshold = 4096;
// If writing keeps failing, stop holding entries in memory beyond this.
static const size_t maxPendingSize = 16 * 1024;

// Before 2021 the clock hasn't been set yet. After a power cut it starts at 1970;
// after a restart it carries on from before, roughly, until the internet time
// arrives.
static const time_t clockSetAfter = 1609459200;

// Entries come from both the main loop and web requests, which run in another
// task, so the held entries and segment files are guarded by a mutex.
static SemaphoreHandle_t logMutex = nullptr;
static String pending;
static uint32_t currentSegment = 1;
static unsigned long lastFlushAt = 0;
// Set from the time sync task when the internet time arrives.
static volatile bool clockSynced = false;
static bool clockSyncLogged = false;

static String segmentPath(uint32_t segment)
{
    char path[24];
    snprintf(path, sizeof(path), "%s/%08lu.csv", logDirectory, static_cast<unsigned long>(segment));

    return path;
}

// Segment paths, oldest first. The zero-padded names sort by age.
static std::vector<String> listSegments()
{
    std::vector<String> paths;

    if (!DataFS.exists(logDirectory))
    {
        return paths;
    }

    File directory = DataFS.open(logDirectory);
    if (!directory || !directory.isDirectory())
    {
        return paths;
    }

    for (File entry = directory.openNextFile(); entry; entry = directory.openNextFile())
    {
        if (!entry.isDirectory())
        {
            paths.push_back(String(logDirectory) + "/" + entry.name());
        }
    }

    std::sort(paths.begin(), paths.end());

    return paths;
}

static void removeOldSegments()
{
    std::vector<String> paths = listSegments();

    for (size_t i = 0; i + maxSegments < paths.size(); i++)
    {
        removeDataFile(paths[i]);
    }
}

// The caller holds logMutex.
static void writePending()
{
    if (pending.isEmpty())
    {
        return;
    }

    String path = segmentPath(currentSegment);
    size_t existingSize = 0;
    if (DataFS.exists(path))
    {
        File existing = DataFS.open(path, "r");
        existingSize = existing ? existing.size() : 0;
    }

    if (existingSize > 0 && existingSize + pending.length() > maxSegmentSize)
    {
        currentSegment++;
        path = segmentPath(currentSegment);
        removeOldSegments();
    }

    File file = DataFS.open(path, "a");
    size_t written = file ? file.print(pending) : 0;
    file.close();

    if (written == pending.length())
    {
        pending = "";
    }
    else if (pending.length() > maxPendingSize)
    {
        Serial.println("Unable to write the device log; dropping held entries");
        pending = "";
    }
}

static String timestamp()
{
    time_t now = time(nullptr);
    if (now < clockSetAfter)
    {
        return "";
    }

    struct tm utc;
    char text[21];
    gmtime_r(&now, &utc);
    strftime(text, sizeof(text), "%Y-%m-%dT%H:%M:%SZ", &utc);

    return text;
}

static String csvField(const String& value)
{
    if (value.indexOf(',') < 0 && value.indexOf('"') < 0 && value.indexOf('\n') < 0)
    {
        return value;
    }

    String quoted = value;
    quoted.replace("\"", "\"\"");

    return "\"" + quoted + "\"";
}

static String resetReasonText(esp_reset_reason_t reason)
{
    switch (reason)
    {
        case ESP_RST_POWERON:
            return "power on or reset button";
        case ESP_RST_EXT:
            return "external reset";
        case ESP_RST_SW:
            return "restarted by the firmware";
        case ESP_RST_PANIC:
            return "crash";
        case ESP_RST_INT_WDT:
        case ESP_RST_TASK_WDT:
        case ESP_RST_WDT:
            return "watchdog (the firmware stopped responding)";
        case ESP_RST_DEEPSLEEP:
            return "woke from deep sleep";
        case ESP_RST_BROWNOUT:
            return "brownout (power dipped)";
        default:
            break;
    }

    // Reasons this ESP-IDF version doesn't name, read from the chip itself.
    RESET_REASON chipReason = rtc_get_reset_reason(0);
    if (chipReason == USB_UART_CHIP_RESET || chipReason == USB_JTAG_CHIP_RESET)
    {
        return "reset over USB, such as an upload";
    }

    return "unknown (chip reason " + String(static_cast<int>(chipReason)) + ")";
}

String firmwareId()
{
    char sha[9];
    esp_ota_get_app_elf_sha256(sha, sizeof(sha));

    return sha;
}

void startDeviceLog()
{
    logMutex = xSemaphoreCreateMutex();

    if (!DataFS.exists(logDirectory))
    {
        DataFS.mkdir(logDirectory);
    }

    std::vector<String> paths = listSegments();
    if (!paths.empty())
    {
        String newest = paths.back();
        currentSegment = newest.substring(newest.lastIndexOf('/') + 1).toInt();
    }

    lastFlushAt = millis();

    sntp_set_time_sync_notification_cb(
        [](struct timeval*)
        {
            clockSynced = true;
        }
    );

    logEvent(
        "boot",
        resetReasonText(esp_reset_reason()) + ", firmware " + firmwareId()
    );
}

void logEvent(const char* event, const String& details)
{
    String line =
        timestamp() + "," +
        String(static_cast<uint32_t>(esp_timer_get_time() / 1000000)) + "," +
        csvField(event) + "," +
        csvField(details) + "\n";

    Serial.printf("[log] %s %s\n", event, details.c_str());

    if (!logMutex)
    {
        return;
    }

    xSemaphoreTake(logMutex, portMAX_DELAY);
    pending += line;
    xSemaphoreGive(logMutex);
}

void processDeviceLog()
{
    if (!logMutex)
    {
        return;
    }

    if (clockSynced && !clockSyncLogged)
    {
        // Times before this entry are missing or approximate.
        clockSyncLogged = true;
        logEvent("clock synced");
    }

    xSemaphoreTake(logMutex, portMAX_DELAY);
    bool due = millis() - lastFlushAt >= flushInterval || pending.length() >= flushThreshold;
    xSemaphoreGive(logMutex);

    if (due)
    {
        flushDeviceLog();
    }
}

void flushDeviceLog()
{
    if (!logMutex)
    {
        return;
    }

    xSemaphoreTake(logMutex, portMAX_DELAY);
    writePending();
    lastFlushAt = millis();
    xSemaphoreGive(logMutex);
}

bool clearDeviceLog()
{
    if (!logMutex)
    {
        return false;
    }

    xSemaphoreTake(logMutex, portMAX_DELAY);

    bool cleared = true;
    for (const String& path : listSegments())
    {
        cleared = removeDataFile(path) && cleared;
    }

    pending = "";
    currentSegment = 1;

    xSemaphoreGive(logMutex);

    return cleared;
}

struct LogDownload
{
    std::vector<String> paths;
    size_t fileIndex = 0;
    size_t offset = 0;
    bool headerSent = false;
};

void sendDeviceLog(AsyncWebServerRequest* request, const String& fileName)
{
    if (!logMutex)
    {
        request->send(503, "text/plain", "The device log isn't available");
        return;
    }

    flushDeviceLog();

    auto download = std::make_shared<LogDownload>();

    xSemaphoreTake(logMutex, portMAX_DELAY);
    download->paths = listSegments();
    xSemaphoreGive(logMutex);

    // Streams the segments one after another, a chunk at a time, so the whole
    // log never has to fit in memory.
    AsyncWebServerResponse* response = request->beginChunkedResponse(
        "text/csv",
        [download](uint8_t* buffer, size_t maxLen, size_t) -> size_t
        {
            if (!download->headerSent)
            {
                download->headerSent = true;
                size_t length = std::min(strlen(csvHeader), maxLen);
                memcpy(buffer, csvHeader, length);

                return length;
            }

            while (download->fileIndex < download->paths.size())
            {
                File file = DataFS.open(download->paths[download->fileIndex], "r");
                if (file && file.seek(download->offset))
                {
                    size_t bytesRead = file.read(buffer, maxLen);
                    if (bytesRead > 0)
                    {
                        download->offset += bytesRead;

                        return bytesRead;
                    }
                }

                // This segment is finished, or was removed since the list was made.
                download->fileIndex++;
                download->offset = 0;
            }

            return 0;
        }
    );

    response->addHeader("Content-Disposition", "attachment; filename=\"" + fileName + "\"");
    response->addHeader("Cache-Control", "no-store");
    request->send(response);
}
