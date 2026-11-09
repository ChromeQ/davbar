#pragma once

#include <RaptLaser.h>
#include <stdint.h>

#include "Strip.h"

namespace Strip
{
    // A drop shows as soon as the laser reports it, so a pour shows straight
    // away. A rise this big is a refill, and shows once the level has stayed
    // within 1 point for SettleSeconds (a keg change involves a lot of moving).
    // Within 1 point, as a reading on the line between two percentages flickers
    // between them. Smaller rises are noise and never show.
    constexpr int32_t SettleSeconds = 60;
    constexpr uint8_t RefillPoints = 5;
    // The battery shows the highest reading of the last hour, to ignore sags
    // while the laser fires. A rise this big is new batteries.
    constexpr int32_t BatteryWindowSeconds = 3600;
    constexpr uint8_t NewBatteryPoints = 5;
    // On its own, the temperature redraws only after moving this far, at most
    // once an hour. Every redraw shows the latest temperature.
    constexpr int16_t TemperatureTenths = 5;
    constexpr int32_t TemperatureSeconds = 3600;
    // The laser counts as in the other mode after this long.
    constexpr int32_t ModeWarningSeconds = 3600;
    // In Smart, a laser broadcasts constantly, so this much silence is a fault.
    constexpr int32_t NoSignalSeconds = 600;
    // After a restart or choosing a laser, how long to wait for its first reading
    // before drawing the strip without one.
    constexpr int32_t FirstReadingSeconds = 60;

    // Decides what the strip shows from the chosen laser's readings, following
    // the redraw rules in PLAN.md. Times are whole seconds since the tap started.
    class Tracker
    {
    public:
        // The laser this tap shows. Call it often; a different laser starts afresh.
        void choose(int32_t now, bool chosen, const uint8_t address[6], uint8_t number, Mode mode);

        // What the screen showed before the tap restarted, for the same laser.
        void restore(int32_t now, const Values& values);

        // Each new reading from the chosen laser (with a distance).
        void addReading(int32_t now, const RaptLaser::Reading& reading);

        // When the laser was last heard, with or without a reading.
        void heard(int32_t at);

        // What the strip should show now. Every redraw uses it, whatever the
        // reason, so each one has the latest of everything.
        Values values(int32_t now) const;

        // Why the strip should redraw now, for the device log, or null if
        // nothing shown has changed enough.
        const char* redrawReason(int32_t now) const;

        // The screen now shows values (or the redraw was skipped or failed;
        // either way, these values don't ask for another).
        void shown(int32_t now, const Values& values);

    private:
        struct BatterySlot
        {
            bool used;
            int32_t slot;
            uint8_t highest;
        };

        // 6 slots of 10 minutes make up the battery's hour.
        static constexpr int BatterySlots = 6;
        static constexpr int32_t BatterySlotSeconds = BatteryWindowSeconds / BatterySlots;

        int highestBattery(int32_t now) const;

        // The choice
        bool initialised = false;
        bool chosen = false;
        uint8_t address[6] = {};
        uint8_t number = 0;
        Mode mode = Mode::Smart;
        int32_t chosenAt = 0;

        // What the screen shows, and whether that was for this laser.
        bool hasShown = false;
        bool shownForThisLaser = false;
        Values shownValues = {};
        int32_t shownAt = 0;

        // The latest reading's level, and the lowest and highest since the level
        // last moved more than 1 point, which is when levelSince starts.
        bool hasLevel = false;
        uint8_t levelPercent = 0;
        uint16_t levelLitresTenths = 0;
        uint8_t lowestPercent = 0;
        uint8_t highestPercent = 0;
        uint16_t lowestLitresTenths = 0;
        int32_t levelSince = 0;

        bool hasBattery = false;
        int32_t batterySince = 0;
        BatterySlot battery[BatterySlots] = {};

        bool hasTemperature = false;
        int16_t temperatureTenths = 0;

        // Whether the latest Smart or Ultra Low Power reading was the other mode.
        bool otherMode = false;
        int32_t otherModeSince = 0;

        int32_t lastHeardAt = 0;
    };
}
