// Runs on the laptop: pio test -d esp32 -e native
// The strip's redraw rules from PLAN.md, with time in seconds since the tap
// started.

#include <RaptLaser.h>
#include <StripTracker.h>
#include <string.h>
#include <unity.h>

using RaptLaser::Mode;
using Strip::Tracker;
using Strip::Values;

static const uint8_t Laser1[6] = {0xE5, 0x4C, 0x66, 0xF9, 0xE1, 0x33};
static const uint8_t Laser2[6] = {0xC4, 0xA3, 0xDF, 0xA2, 0xC5, 0x1B};

static Tracker tracker;

void setUp()
{
    tracker = Tracker();
}

void tearDown() {}

// The laser distance for a whole percentage of a 19 L keg.
static uint16_t distanceFor(uint8_t percent)
{
    return 552 - (percent * 53 + 9) / 10;
}

static RaptLaser::Reading reading(
    uint16_t distanceMm,
    uint16_t batteryTenths = 1000,
    int16_t temperatureHundredths = 1800,
    Mode mode = Mode::Smart
)
{
    RaptLaser::Reading result = {};
    memcpy(result.address, Laser1, sizeof(result.address));
    result.hasDistance = true;
    result.distanceMm = distanceMm;
    result.hasBattery = true;
    result.batteryTenthsPercent = batteryTenths;
    result.hasTemperature = true;
    result.temperatureHundredthsC = temperatureHundredths;
    result.mode = mode;
    return result;
}

static void chooseLaser1(int32_t now, Strip::Mode mode = Strip::Mode::Smart)
{
    tracker.choose(now, true, Laser1, 1, mode);
}

// In Smart a laser is heard every few seconds, with or without a new reading,
// so most tests mark it heard when they check.
static const char* reasonAt(int32_t now)
{
    tracker.heard(now);
    return tracker.redrawReason(now);
}

// Redraws now if asked to, as the tap does.
static void redrawIfDue(int32_t now)
{
    if (tracker.redrawReason(now))
    {
        tracker.shown(now, tracker.values(now));
    }
}

// Chooses laser 1, gives it a reading at second 10 and shows it.
static void showFirstReading(
    uint8_t percent,
    uint16_t batteryTenths = 1000,
    Strip::Mode mode = Strip::Mode::Smart
)
{
    chooseLaser1(0, mode);
    tracker.addReading(
        10,
        reading(distanceFor(percent), batteryTenths, 1800, mode == Strip::Mode::Eco ? Mode::UltraLowPower : Mode::Smart)
    );
    TEST_ASSERT_EQUAL_STRING("first reading", tracker.redrawReason(10));
    tracker.shown(10, tracker.values(10));
}

static void testFirstReadingShowsStraightAway()
{
    chooseLaser1(0);
    TEST_ASSERT_NULL(reasonAt(5));

    tracker.addReading(10, reading(distanceFor(84), 1000, 1825));
    TEST_ASSERT_EQUAL_STRING("first reading", reasonAt(10));

    Values values = tracker.values(10);
    TEST_ASSERT_TRUE(values.laserChosen);
    TEST_ASSERT_EQUAL_UINT8(1, values.laserNumber);
    TEST_ASSERT_TRUE(values.hasLevel);
    TEST_ASSERT_EQUAL_UINT8(84, values.percent);
    TEST_ASSERT_EQUAL_UINT16(159, values.litresTenths);
    TEST_ASSERT_EQUAL_INT16(183, values.temperatureTenths);
    TEST_ASSERT_EQUAL_UINT8(100, values.batteryPercent);

    tracker.shown(10, values);
    TEST_ASSERT_NULL(reasonAt(11));
}

static void testDrawsWithoutAReadingAfterAMinute()
{
    chooseLaser1(0);
    TEST_ASSERT_NULL(reasonAt(59));
    TEST_ASSERT_EQUAL_STRING("no reading yet", reasonAt(60));
    TEST_ASSERT_FALSE(tracker.values(60).hasLevel);
}

static void testNoLaserDrawsStraightAway()
{
    tracker.choose(0, false, Laser1, 0, Strip::Mode::Smart);
    TEST_ASSERT_EQUAL_STRING("no laser", reasonAt(0));
    TEST_ASSERT_FALSE(tracker.values(0).laserChosen);
}

// A pour shows as soon as the laser reports it. If it measured mid-pour, the
// next reading redraws again with the final level.
static void testDropRedrawsStraightAway()
{
    showFirstReading(84);

    tracker.addReading(100, reading(distanceFor(82)));
    TEST_ASSERT_EQUAL_STRING("level", reasonAt(100));
    TEST_ASSERT_EQUAL_UINT8(82, tracker.values(100).percent);
    redrawIfDue(100);

    tracker.addReading(135, reading(distanceFor(79)));
    TEST_ASSERT_EQUAL_STRING("level", reasonAt(135));
    TEST_ASSERT_EQUAL_UINT8(79, tracker.values(135).percent);
}

// Live Stream sends a reading every 10s, and on the line between two
// percentages it flickers between them. The drop shows once, as the level
// never goes back up by 1 point.
static void testFlickerAfterADropRedrawsOnce()
{
    showFirstReading(84);

    tracker.addReading(100, reading(distanceFor(80)));
    TEST_ASSERT_EQUAL_STRING("level", reasonAt(100));
    redrawIfDue(100);

    for (int32_t now = 110; now <= 400; now += 10)
    {
        tracker.addReading(now, reading(distanceFor(now % 20 == 0 ? 80 : 81)));
        TEST_ASSERT_NULL(reasonAt(now));
    }

    TEST_ASSERT_EQUAL_UINT8(80, tracker.values(400).percent);
}

// What tap 1 saw: shown at 95%, then readings flickering between 99% and 100%.
// The lowest, 99%, is only 4 points up, so it isn't a refill.
static void testFlickeringJustUnderARefillNeverShows()
{
    showFirstReading(95);

    for (int32_t now = 100; now <= 400; now += 10)
    {
        tracker.addReading(now, reading(distanceFor(now % 20 == 0 ? 99 : 100)));
        TEST_ASSERT_NULL(reasonAt(now));
    }
}

static void testSmallRiseNeverShows()
{
    showFirstReading(80);

    tracker.addReading(100, reading(distanceFor(84)));
    TEST_ASSERT_NULL(reasonAt(1000));
    TEST_ASSERT_EQUAL_UINT8(80, tracker.values(1000).percent);
}

static void testRefillShowsOnceSettled()
{
    showFirstReading(20);

    tracker.addReading(100, reading(distanceFor(99)));
    TEST_ASSERT_NULL(reasonAt(159));
    TEST_ASSERT_EQUAL_STRING("refill", reasonAt(160));
    TEST_ASSERT_EQUAL_UINT8(99, tracker.values(160).percent);
}

// 330 mm deep is 62% and 11.8 L; 329 mm is still 62% but 11.7 L.
static void testLitresWithinThePercentageWaitForTheNextRedraw()
{
    chooseLaser1(0);
    tracker.addReading(10, reading(552 - 330));
    redrawIfDue(10);
    TEST_ASSERT_EQUAL_UINT16(118, tracker.values(10).litresTenths);

    tracker.addReading(100, reading(552 - 329));
    TEST_ASSERT_NULL(reasonAt(1000));
    TEST_ASSERT_EQUAL_UINT8(62, tracker.values(1000).percent);
    TEST_ASSERT_EQUAL_UINT16(117, tracker.values(1000).litresTenths);
}

static void testBatteryIgnoresSagsWithinTheHour()
{
    showFirstReading(84, 1000);

    tracker.addReading(100, reading(distanceFor(84), 770));
    TEST_ASSERT_NULL(reasonAt(200));
    TEST_ASSERT_EQUAL_UINT8(100, tracker.values(200).batteryPercent);

    // An hour on, 100% is out of the window and 85% is the highest.
    tracker.addReading(4000, reading(distanceFor(84), 850));
    TEST_ASSERT_EQUAL_STRING("battery", reasonAt(4000));
    TEST_ASSERT_EQUAL_UINT8(85, tracker.values(4000).batteryPercent);
}

static void testBatteryCanRiseInTheFirstHour()
{
    // The first reading came during a sag.
    showFirstReading(84, 780);

    tracker.addReading(600, reading(distanceFor(84), 850));
    TEST_ASSERT_EQUAL_STRING("battery", reasonAt(600));
    TEST_ASSERT_EQUAL_UINT8(85, tracker.values(600).batteryPercent);
}

static void testSmallBatteryRiseAfterTheFirstHourNeverShows()
{
    showFirstReading(84, 800);

    tracker.addReading(5000, reading(distanceFor(84), 830));
    TEST_ASSERT_NULL(reasonAt(5000));
    TEST_ASSERT_EQUAL_UINT8(80, tracker.values(5000).batteryPercent);
}

static void testNewBatteriesShowStraightAway()
{
    showFirstReading(84, 400);

    tracker.addReading(5000, reading(distanceFor(84), 1000));
    TEST_ASSERT_EQUAL_STRING("battery", reasonAt(5000));
    TEST_ASSERT_EQUAL_UINT8(100, tracker.values(5000).batteryPercent);
}

static void testBatteryRedrawsOnlyWhenTheIconChanges()
{
    showFirstReading(84, 950);

    // 95% and 92% both show 9 of the 10 steps, so no redraw for it alone, but
    // the next redraw shows 92%.
    tracker.addReading(4000, reading(distanceFor(84), 920));
    TEST_ASSERT_NULL(reasonAt(4000));
    TEST_ASSERT_EQUAL_UINT8(92, tracker.values(4000).batteryPercent);
}

static void testTemperatureRedrawsAfterHalfADegreeAndAnHour()
{
    showFirstReading(84);

    tracker.addReading(100, reading(distanceFor(84), 1000, 1840));
    TEST_ASSERT_NULL(reasonAt(5000));

    tracker.addReading(200, reading(distanceFor(84), 1000, 1850));
    TEST_ASSERT_NULL(reasonAt(3609));
    TEST_ASSERT_EQUAL_STRING("temperature", reasonAt(3610));
}

static void testEveryRedrawHasTheLatestTemperature()
{
    showFirstReading(84);

    tracker.addReading(100, reading(distanceFor(80), 1000, 1825));
    TEST_ASSERT_EQUAL_STRING("level", reasonAt(100));
    TEST_ASSERT_EQUAL_INT16(183, tracker.values(100).temperatureTenths);
}

// What tap 1 saw: an hour after the last redraw, a button press sent a reading
// with a lower level and a new temperature. One redraw, with both.
static void testDropAndTemperatureRedrawOnce()
{
    showFirstReading(87);

    tracker.addReading(4000, reading(distanceFor(78), 1000, 2125));
    TEST_ASSERT_EQUAL_STRING("level", reasonAt(4000));
    redrawIfDue(4000);
    TEST_ASSERT_EQUAL_UINT8(78, tracker.values(4000).percent);
    TEST_ASSERT_EQUAL_INT16(213, tracker.values(4000).temperatureTenths);
    TEST_ASSERT_NULL(reasonAt(4001));
}

// A small rise never shows, so it holds the temperature back only for a minute.
static void testTemperatureWaitsOnlyAMinuteForASmallRise()
{
    showFirstReading(84);

    tracker.addReading(4000, reading(distanceFor(86), 1000, 2125));
    TEST_ASSERT_NULL(reasonAt(4059));
    TEST_ASSERT_EQUAL_STRING("temperature", reasonAt(4060));
}

static void testModeWarningAfterAnHourInTheOtherMode()
{
    showFirstReading(84);

    tracker.addReading(100, reading(distanceFor(84), 1000, 1800, Mode::UltraLowPower));
    tracker.addReading(2000, reading(distanceFor(84), 1000, 1800, Mode::Session));
    TEST_ASSERT_NULL(reasonAt(3699));
    TEST_ASSERT_EQUAL_STRING("mode warning", reasonAt(3700));
    redrawIfDue(3700);

    tracker.addReading(4000, reading(distanceFor(84), 1000, 1800, Mode::Smart));
    TEST_ASSERT_EQUAL_STRING("mode warning cleared", reasonAt(4000));
}

static void testEcoWarnsAboutSmart()
{
    showFirstReading(84, 1000, Strip::Mode::Eco);

    tracker.addReading(100, reading(distanceFor(84), 1000, 1800, Mode::Smart));
    TEST_ASSERT_EQUAL_STRING("mode warning", reasonAt(3700));
}

static void testNoSignalAfterTenMinutesInSmart()
{
    showFirstReading(84);

    tracker.heard(20);
    TEST_ASSERT_NULL(tracker.redrawReason(620));
    TEST_ASSERT_EQUAL_STRING("no signal", tracker.redrawReason(621));
    redrawIfDue(621);

    tracker.heard(700);
    TEST_ASSERT_EQUAL_STRING("signal back", tracker.redrawReason(700));
}

static void testEcoSilenceIsNormal()
{
    showFirstReading(84, 1000, Strip::Mode::Eco);
    TEST_ASSERT_NULL(reasonAt(50000));
}

static Values restoredValues()
{
    Values values = {};
    values.laserChosen = true;
    values.laserNumber = 1;
    values.hasLevel = true;
    values.percent = 84;
    values.litresTenths = 159;
    values.hasTemperature = true;
    values.temperatureTenths = 180;
    values.hasBattery = true;
    values.batteryPercent = 100;
    return values;
}

static void testRestoreKeepsWhatTheScreenShowed()
{
    chooseLaser1(0);
    tracker.restore(0, restoredValues());

    TEST_ASSERT_NULL(reasonAt(0));
    TEST_ASSERT_NULL(reasonAt(500));
    TEST_ASSERT_EQUAL_UINT8(84, tracker.values(500).percent);

    tracker.addReading(510, reading(distanceFor(84)));
    TEST_ASSERT_NULL(reasonAt(510));
}

static void testRestoreKeepsTheModeWarning()
{
    Values values = restoredValues();
    values.modeWarning = true;
    chooseLaser1(0);
    tracker.restore(0, values);

    TEST_ASSERT_NULL(reasonAt(0));
    TEST_ASSERT_TRUE(tracker.values(0).modeWarning);
}

static void testChoosingAnotherLaserStartsAfresh()
{
    showFirstReading(84);

    tracker.choose(100, true, Laser2, 2, Strip::Mode::Smart);
    TEST_ASSERT_NULL(reasonAt(150));

    RaptLaser::Reading second = reading(distanceFor(50), 600);
    memcpy(second.address, Laser2, sizeof(second.address));
    tracker.addReading(155, second);
    TEST_ASSERT_EQUAL_STRING("laser chosen", reasonAt(155));

    Values values = tracker.values(155);
    TEST_ASSERT_EQUAL_UINT8(2, values.laserNumber);
    TEST_ASSERT_EQUAL_UINT8(50, values.percent);
    TEST_ASSERT_EQUAL_UINT8(60, values.batteryPercent);
}

static void testChangingModeRedrawsStraightAway()
{
    showFirstReading(84);

    chooseLaser1(100, Strip::Mode::Eco);
    TEST_ASSERT_EQUAL_STRING("mode chosen", reasonAt(100));
    TEST_ASSERT_EQUAL_UINT8(84, tracker.values(100).percent);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(testFirstReadingShowsStraightAway);
    RUN_TEST(testDrawsWithoutAReadingAfterAMinute);
    RUN_TEST(testNoLaserDrawsStraightAway);
    RUN_TEST(testDropRedrawsStraightAway);
    RUN_TEST(testFlickerAfterADropRedrawsOnce);
    RUN_TEST(testFlickeringJustUnderARefillNeverShows);
    RUN_TEST(testSmallRiseNeverShows);
    RUN_TEST(testRefillShowsOnceSettled);
    RUN_TEST(testLitresWithinThePercentageWaitForTheNextRedraw);
    RUN_TEST(testBatteryIgnoresSagsWithinTheHour);
    RUN_TEST(testBatteryCanRiseInTheFirstHour);
    RUN_TEST(testSmallBatteryRiseAfterTheFirstHourNeverShows);
    RUN_TEST(testNewBatteriesShowStraightAway);
    RUN_TEST(testBatteryRedrawsOnlyWhenTheIconChanges);
    RUN_TEST(testTemperatureRedrawsAfterHalfADegreeAndAnHour);
    RUN_TEST(testEveryRedrawHasTheLatestTemperature);
    RUN_TEST(testDropAndTemperatureRedrawOnce);
    RUN_TEST(testTemperatureWaitsOnlyAMinuteForASmallRise);
    RUN_TEST(testModeWarningAfterAnHourInTheOtherMode);
    RUN_TEST(testEcoWarnsAboutSmart);
    RUN_TEST(testNoSignalAfterTenMinutesInSmart);
    RUN_TEST(testEcoSilenceIsNormal);
    RUN_TEST(testRestoreKeepsWhatTheScreenShowed);
    RUN_TEST(testRestoreKeepsTheModeWarning);
    RUN_TEST(testChoosingAnotherLaserStartsAfresh);
    RUN_TEST(testChangingModeRedrawsStraightAway);
    return UNITY_END();
}
