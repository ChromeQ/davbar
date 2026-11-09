#include "StripManager.h"

#include <RaptLaser.h>
#include <Strip.h>

#include "LaserScanner.h"

// Rounded half away from zero, so 18.25 °C shows as 18.3°.
static int16_t hundredthsToTenths(int16_t hundredths)
{
    return (hundredths >= 0 ? hundredths + 5 : hundredths - 5) / 10;
}

static Strip::Values currentValues()
{
    ChosenLaser laser = getChosenLaser();
    Strip::Values values = {};

    values.laserChosen = laser.chosen;
    values.laserNumber = laser.number;
    values.mode = laser.eco ? Strip::Mode::Eco : Strip::Mode::Smart;

    if (!laser.hasReading)
    {
        return values;
    }

    const RaptLaser::Reading& reading = laser.reading;
    RaptLaser::KegLevel level = RaptLaser::kegLevel(reading.distanceMm);
    values.hasLevel = true;
    values.percent = level.percent;
    values.litresTenths = level.litresTenths;

    if (reading.hasTemperature)
    {
        values.hasTemperature = true;
        values.temperatureTenths = hundredthsToTenths(reading.temperatureHundredthsC);
    }

    if (reading.hasBattery)
    {
        values.hasBattery = true;
        values.batteryPercent = reading.batteryTenthsPercent / 10;
    }

    return values;
}

void drawStrip(uint8_t* strip)
{
    Strip::draw(strip, currentValues());
}
