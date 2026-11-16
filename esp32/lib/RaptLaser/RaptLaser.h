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

    // What the laser read with that much in the keg.
    struct KegPoint
    {
        uint16_t distanceMm;
        uint16_t litresTenths;
    };

    // A keg's points from empty to full: the distances going down and the
    // litres going up. Between two points the keg is taken to fill evenly, so
    // the litres are on the straight line between them.
    struct KegCalibration
    {
        const KegPoint* points;
        uint8_t count;

        // A full keg: the last point's litres.
        constexpr uint16_t capacityTenthsLitres() const
        {
            return points[count - 1].litresTenths;
        }
    };

    // A 19 L Corny keg with the RAPT lid kit and a floating dip tube, filled
    // from a jug on 2026-11-16 (PLAN.md, "Calibration"):
    // - The domed bottom, up to 3 L, is every point measured, 0.5 L apart.
    // - Above it the keg is a straight cylinder: one line, 27.2 mm a litre,
    //   fitted to the readings from 5 L to 18.5 L. From 3 L to 5 L it joins the
    //   dome to the line.
    // - The laser reads short this close, so 29 mm or nearer is full.
    // Keep it the same as CORNY_KEG_19L in app/rapt-laser.
    constexpr KegPoint Corny19LPoints[] = {
        {566, 0},
        {557, 5},
        {546, 10},
        {528, 15},
        {512, 20},
        {487, 25},
        {467, 30},
        {399, 50},
        {45, 180},
        {29, 190},
    };

    constexpr KegCalibration Corny19L {
        Corny19LPoints,
        sizeof(Corny19LPoints) / sizeof(Corny19LPoints[0]),
    };

    struct KegLevel
    {
        // Rounded down to 0.1 L, like the RAPT app.
        uint16_t litresTenths;
        // Of a full keg's litres, rounded down to a whole percent.
        uint8_t percent;
    };

    // Beyond the first point the keg is empty, and nearer than the last it is
    // full. A calibration with fewer than 2 points, or points out of order,
    // gives an empty keg.
    KegLevel kegLevel(uint16_t distanceMm, const KegCalibration& keg = Corny19L);
}
