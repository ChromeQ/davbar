#include "RaptLaser.h"

#include <stdio.h>
#include <string.h>

namespace RaptLaser
{
    static const size_t PayloadLength = 19;
    // "PT", then 0xA1, the only value seen from the lasers. Other RAPT devices,
    // such as the Pill, share the company ID, so anything else is rejected.
    static const uint8_t Signature[] = {0x50, 0x54, 0xa1};
    static const uint16_t NoDistance = 0;
    static const uint16_t NoBattery = 0xffff;
    static const int16_t NoTemperature = -0x8000; // 0x8000 read as a signed value

    static uint16_t readUint16(const uint8_t* bytes)
    {
        return static_cast<uint16_t>(bytes[0] | (bytes[1] << 8));
    }

    bool decodePayload(const uint8_t* payload, size_t length, Reading& reading)
    {
        if (length != PayloadLength || memcmp(payload, Signature, sizeof(Signature)) != 0)
        {
            return false;
        }

        uint16_t distance = readUint16(payload + 9);
        uint16_t battery = readUint16(payload + 14);
        int16_t temperature = static_cast<int16_t>(readUint16(payload + 16));
        uint8_t mode = payload[18];

        memcpy(reading.address, payload + 3, sizeof(reading.address));
        reading.hasDistance = distance != NoDistance;
        reading.distanceMm = reading.hasDistance ? distance : 0;
        reading.hasBattery = battery != NoBattery;
        reading.batteryTenthsPercent = reading.hasBattery ? battery : 0;
        reading.hasTemperature = temperature != NoTemperature;
        reading.temperatureHundredthsC = reading.hasTemperature ? temperature : 0;
        reading.mode = mode >= 1 && mode <= 4 ? static_cast<Mode>(mode) : Mode::Unknown;

        return true;
    }

    bool decodeManufacturerData(const uint8_t* data, size_t length, Reading& reading)
    {
        if (length < 2 || readUint16(data) != CompanyId)
        {
            return false;
        }

        return decodePayload(data + 2, length - 2, reading);
    }

    const char* modeName(Mode mode)
    {
        switch (mode)
        {
            case Mode::Smart:
                return "Smart";
            case Mode::Session:
                return "Session";
            case Mode::LiveStream:
                return "Live Stream";
            case Mode::UltraLowPower:
                return "Ultra Low Power";
            default:
                return "unknown";
        }
    }

    static int hexValue(char digit)
    {
        if (digit >= '0' && digit <= '9')
        {
            return digit - '0';
        }

        if (digit >= 'A' && digit <= 'F')
        {
            return digit - 'A' + 10;
        }

        if (digit >= 'a' && digit <= 'f')
        {
            return digit - 'a' + 10;
        }

        return -1;
    }

    bool parseAddress(const char* text, uint8_t address[6])
    {
        uint8_t parsed[6];

        for (int i = 0; i < 6; i++)
        {
            const char* pair = text + i * 3;
            int high = hexValue(pair[0]);
            int low = high < 0 ? -1 : hexValue(pair[1]);

            if (low < 0)
            {
                return false;
            }

            // A colon between pairs, and nothing after the last one.
            char separator = i < 5 ? ':' : '\0';
            if (pair[2] != separator)
            {
                return false;
            }

            parsed[i] = static_cast<uint8_t>(high * 16 + low);
        }

        for (int i = 0; i < 6; i++)
        {
            address[i] = parsed[i];
        }

        return true;
    }

    void formatAddress(const uint8_t address[6], char* text)
    {
        snprintf(
            text,
            18,
            "%02X:%02X:%02X:%02X:%02X:%02X",
            address[0],
            address[1],
            address[2],
            address[3],
            address[4],
            address[5]
        );
    }

    KegLevel kegLevel(uint16_t distanceMm, const KegCalibration& keg)
    {
        if (keg.emptyDistanceMm <= keg.fullDistanceMm)
        {
            return {0, 0};
        }

        uint32_t range = keg.emptyDistanceMm - keg.fullDistanceMm;
        uint32_t depth = distanceMm >= keg.emptyDistanceMm ? 0 : keg.emptyDistanceMm - distanceMm;
        if (depth > range)
        {
            depth = range;
        }

        // Whole-number division rounds down, the same as Math.floor in TypeScript.
        return {
            static_cast<uint16_t>(keg.capacityTenthsLitres * depth / range),
            static_cast<uint8_t>(100 * depth / range),
        };
    }
}
