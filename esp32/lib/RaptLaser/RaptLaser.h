#pragma once

#include <stddef.h>
#include <stdint.h>

// Decodes RAPT Laser Level Sensor Bluetooth advertisements and converts the
// distance to what is left in the keg. The same rules as the TypeScript decoder
// in app/rapt-laser, and tested on the laptop against the same captures
// (pio test -e native). It has no Arduino code so that it builds for both.
namespace RaptLaser
{
    // Bluetooth company ID at the start of RAPT manufacturer data ("RA").
    constexpr uint16_t CompanyId = 0x4152;

    enum class Mode : uint8_t
    {
        Unknown = 0,
        Smart = 1,
        Session = 2,
        LiveStream = 3,
        UltraLowPower = 4,
    };

    // Whole numbers throughout: tenths of a percent and hundredths of a degree.
    struct Reading
    {
        uint8_t address[6];
        // Each value can be missing, for example while the RAPT app is connected.
        bool hasDistance;
        uint16_t distanceMm;
        bool hasBattery;
        uint16_t batteryTenthsPercent;
        bool hasTemperature;
        int16_t temperatureHundredthsC;
        // Unknown for a mode value not seen before.
        Mode mode;
    };

    // Decodes the 19-byte payload that follows the company ID. Returns false for
    // anything that isn't a laser payload, such as a RAPT Pill's.
    bool decodePayload(const uint8_t* payload, size_t length, Reading& reading);

    // Decodes manufacturer data as Bluetooth libraries report it: the company ID
    // (2 bytes, little-endian), then the payload.
    bool decodeManufacturerData(const uint8_t* data, size_t length, Reading& reading);

    const char* modeName(Mode mode);

    // Writes the address as "E5:4C:66:F9:E1:33", which needs 18 characters.
    void formatAddress(const uint8_t address[6], char* text);

    // Reads an address written like "E5:4C:66:F9:E1:33" (either case). Returns
    // false, leaving address unchanged, for anything else.
    bool parseAddress(const char* text, uint8_t address[6]);

    // The laser distances for an empty and a full keg.
    struct KegCalibration
    {
        uint16_t capacityTenthsLitres;
        uint16_t emptyDistanceMm;
        uint16_t fullDistanceMm;
    };

    // A 19 L corny keg with the RAPT lid kit. Matches every RAPT app reading so
    // far. Check against a real keg at the next keg change, and keep it the same
    // as CORNY_KEG_19L in app/rapt-laser.
    constexpr KegCalibration Corny19L {190, 552, 22};

    struct KegLevel
    {
        // Rounded down to 0.1 L, like the RAPT app.
        uint16_t litresTenths;
        // Rounded down to a whole percent.
        uint8_t percent;
    };

    // Treats the keg as a straight-sided cylinder. A calibration with the empty
    // distance not above the full distance gives an empty keg.
    KegLevel kegLevel(uint16_t distanceMm, const KegCalibration& keg = Corny19L);
}
