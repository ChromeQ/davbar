#include "StripTracker.h"

#include <stdlib.h>
#include <string.h>

namespace Strip
{
    namespace
    {
        // Rounded half away from zero, so 18.25 °C shows as 18.3°.
        int16_t hundredthsToTenths(int16_t hundredths)
        {
            return (hundredths >= 0 ? hundredths + 5 : hundredths - 5) / 10;
        }

        // The battery icon changes in 10% steps, and in 1% steps below 10%.
        int batteryStep(uint8_t percent)
        {
            return percent < 10 ? percent : percent / 10 * 10;
        }
    }

    void Tracker::choose(
        int32_t now,
        bool isChosen,
        const uint8_t laserAddress[6],
        uint8_t laserNumber,
        Mode laserMode
    )
    {
        bool sameLaser =
            initialised &&
            chosen == isChosen &&
            (!isChosen || memcmp(address, laserAddress, sizeof(address)) == 0);

        if (!sameLaser)
        {
            initialised = true;
            chosen = isChosen;
            memcpy(address, laserAddress, sizeof(address));
            chosenAt = now;
            shownForThisLaser = false;
            hasLevel = false;
            hasBattery = false;
            memset(battery, 0, sizeof(battery));
            hasTemperature = false;
            otherMode = false;
            lastHeardAt = now;
        }

        // Which mode is the other one depends on the chosen mode.
        if (laserMode != mode)
        {
            otherMode = false;
        }

        number = laserNumber;
        mode = laserMode;
    }

    void Tracker::restore(int32_t now, const Values& values)
    {
        hasShown = true;
        shownForThisLaser = true;
        shownValues = values;
        shownAt = now;

        // Carry the warnings over the restart, so they don't go off and come back.
        if (values.modeWarning)
        {
            otherMode = true;
            otherModeSince = now - ModeWarningSeconds;
        }

        if (values.noSignal)
        {
            lastHeardAt = now - NoSignalSeconds - 1;
        }
    }

    void Tracker::addReading(int32_t now, const RaptLaser::Reading& reading)
    {
        heard(now);

        if (reading.hasDistance)
        {
            RaptLaser::KegLevel level = RaptLaser::kegLevel(reading.distanceMm);
            uint8_t lowest = hasLevel && lowestPercent < level.percent ? lowestPercent : level.percent;
            uint8_t highest = hasLevel && highestPercent > level.percent ? highestPercent : level.percent;

            if (!hasLevel || highest - lowest > 1)
            {
                // Moved, so it starts settling again from this reading.
                levelSince = now;
                lowestPercent = level.percent;
                highestPercent = level.percent;
                lowestLitresTenths = level.litresTenths;
            }
            else
            {
                lowestPercent = lowest;
                highestPercent = highest;
                if (level.litresTenths < lowestLitresTenths)
                {
                    lowestLitresTenths = level.litresTenths;
                }
            }

            hasLevel = true;
            levelPercent = level.percent;
            levelLitresTenths = level.litresTenths;
        }

        if (reading.hasBattery)
        {
            uint8_t percent = reading.batteryTenthsPercent >= 1000
                ? 100
                : reading.batteryTenthsPercent / 10;

            if (!hasBattery)
            {
                hasBattery = true;
                batterySince = now;
            }

            int32_t slot = now / BatterySlotSeconds;
            BatterySlot& entry = battery[slot % BatterySlots];
            if (!entry.used || entry.slot != slot)
            {
                entry = {true, slot, percent};
            }
            else if (percent > entry.highest)
            {
                entry.highest = percent;
            }
        }

        if (reading.hasTemperature)
        {
            hasTemperature = true;
            temperatureTenths = hundredthsToTenths(reading.temperatureHundredthsC);
        }

        // Session and Live Stream never count either way.
        RaptLaser::Mode expected = mode == Mode::Eco
            ? RaptLaser::Mode::UltraLowPower
            : RaptLaser::Mode::Smart;
        RaptLaser::Mode other = mode == Mode::Eco
            ? RaptLaser::Mode::Smart
            : RaptLaser::Mode::UltraLowPower;

        if (reading.mode == expected)
        {
            otherMode = false;
        }
        else if (reading.mode == other && !otherMode)
        {
            otherMode = true;
            otherModeSince = now;
        }
    }

    void Tracker::heard(int32_t at)
    {
        if (at > lastHeardAt)
        {
            lastHeardAt = at;
        }
    }

    // The highest battery reading in the last hour, or -1 for none.
    int Tracker::highestBattery(int32_t now) const
    {
        int32_t slot = now / BatterySlotSeconds;
        int highest = -1;

        for (const BatterySlot& entry : battery)
        {
            if (entry.used && slot - entry.slot < BatterySlots && entry.highest > highest)
            {
                highest = entry.highest;
            }
        }

        return highest;
    }

    Values Tracker::values(int32_t now) const
    {
        Values next = {};
        next.laserChosen = chosen;

        if (!chosen)
        {
            return next;
        }

        next.laserNumber = number;
        next.mode = mode;

        // What the screen shows, if it's this laser's: each value starts from it.
        const Values* shown = hasShown && shownForThisLaser ? &shownValues : nullptr;

        // The level only goes down, straight away, or up by a refill once it has
        // settled, showing the lowest reading since. The first level shows
        // straight away.
        if (shown && shown->hasLevel)
        {
            next.hasLevel = true;
            next.percent = shown->percent;
            next.litresTenths = shown->litresTenths;

            bool settled = hasLevel && now - levelSince >= SettleSeconds;
            if (hasLevel && levelLitresTenths < shown->litresTenths)
            {
                next.percent = levelPercent;
                next.litresTenths = levelLitresTenths;
            }
            else if (settled && lowestPercent >= shown->percent + RefillPoints)
            {
                next.percent = lowestPercent;
                next.litresTenths = lowestLitresTenths;
            }
        }
        else if (hasLevel)
        {
            next.hasLevel = true;
            next.percent = levelPercent;
            next.litresTenths = levelLitresTenths;
        }

        // The battery shows the highest reading of the last hour. It only goes
        // down once a full hour has been heard, as until then the highest may
        // still be a sag; new batteries show straight away.
        int highest = highestBattery(now);
        if (shown && shown->hasBattery)
        {
            next.hasBattery = true;
            next.batteryPercent = shown->batteryPercent;

            if (highest >= 0)
            {
                bool fullHour = now - batterySince >= BatteryWindowSeconds;
                bool newBatteries = highest >= shown->batteryPercent + NewBatteryPoints;
                bool rising = !fullHour && highest > shown->batteryPercent;
                bool falling = fullHour && highest < shown->batteryPercent;
                if (newBatteries || rising || falling)
                {
                    next.batteryPercent = highest;
                }
            }
        }
        else if (highest >= 0)
        {
            next.hasBattery = true;
            next.batteryPercent = highest;
        }

        if (hasTemperature)
        {
            next.hasTemperature = true;
            next.temperatureTenths = temperatureTenths;
        }
        else if (shown && shown->hasTemperature)
        {
            next.hasTemperature = true;
            next.temperatureTenths = shown->temperatureTenths;
        }

        next.modeWarning = otherMode && now - otherModeSince >= ModeWarningSeconds;
        next.noSignal = mode == Mode::Smart && now - lastHeardAt > NoSignalSeconds;

        return next;
    }

    const char* Tracker::redrawReason(int32_t now) const
    {
        Values next = values(now);

        // After a restart or a new choice, wait a little for the laser, so the
        // strip draws once, with its reading.
        if (next.laserChosen && !next.hasLevel && now - chosenAt < FirstReadingSeconds)
        {
            return nullptr;
        }

        if (!hasShown)
        {
            if (!next.laserChosen)
            {
                return "no laser";
            }

            return next.hasLevel ? "first reading" : "no reading yet";
        }

        const Values& shown = shownValues;

        if (next.laserChosen != shown.laserChosen)
        {
            return next.laserChosen ? "laser chosen" : "no laser";
        }

        if (!next.laserChosen)
        {
            return nullptr;
        }

        if (!shownForThisLaser || next.laserNumber != shown.laserNumber)
        {
            return "laser chosen";
        }

        if (next.mode != shown.mode)
        {
            return "mode chosen";
        }

        if (next.hasLevel != shown.hasLevel)
        {
            return "first reading";
        }

        if (next.percent != shown.percent)
        {
            return next.percent > shown.percent ? "refill" : "level";
        }

        // A rise in the last minute may be a refill about to show, so the
        // battery and temperature wait for it, to redraw once with all three.
        bool levelSettling =
            hasLevel &&
            now - levelSince < SettleSeconds &&
            levelPercent != shown.percent;

        if (
            !levelSettling &&
            (
                next.hasBattery != shown.hasBattery ||
                batteryStep(next.batteryPercent) != batteryStep(shown.batteryPercent)
            )
        )
        {
            return "battery";
        }

        if (next.noSignal != shown.noSignal)
        {
            return next.noSignal ? "no signal" : "signal back";
        }

        if (next.modeWarning != shown.modeWarning)
        {
            return next.modeWarning ? "mode warning" : "mode warning cleared";
        }

        if (levelSettling)
        {
            return nullptr;
        }

        if (next.hasTemperature != shown.hasTemperature)
        {
            return "temperature";
        }

        if (
            next.hasTemperature &&
            abs(next.temperatureTenths - shown.temperatureTenths) >= TemperatureTenths &&
            now - shownAt >= TemperatureSeconds
        )
        {
            return "temperature";
        }

        return nullptr;
    }

    void Tracker::shown(int32_t now, const Values& values)
    {
        hasShown = true;
        shownForThisLaser = true;
        shownValues = values;
        shownAt = now;
    }
}
