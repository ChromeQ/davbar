// Runs on the laptop: pio test -d esp32 -e native
// The captures and keg levels match app/rapt-laser/tests, so the C++ and
// TypeScript decoders are checked against the same data.

#include <RaptLaser.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unity.h>

using RaptLaser::Mode;
using RaptLaser::Reading;

void setUp() {}

void tearDown() {}

static size_t hexToBytes(const char* hex, uint8_t* bytes)
{
    size_t length = strlen(hex) / 2;

    for (size_t i = 0; i < length; i++)
    {
        char pair[3] = {hex[i * 2], hex[i * 2 + 1], 0};
        bytes[i] = static_cast<uint8_t>(strtol(pair, nullptr, 16));
    }

    return length;
}

static bool decodeHex(const char* hex, Reading& reading)
{
    uint8_t bytes[64];
    size_t length = hexToBytes(hex, bytes);

    return RaptLaser::decodePayload(bytes, length, reading);
}

static const char* Payload133 = "5054A1E54C66F9E1338500AB010AE8031B0801";

struct Capture
{
    const char* name;
    const char* hex;
    bool hasDistance;
    uint16_t distanceMm;
    bool hasBattery;
    uint16_t batteryTenthsPercent;
    bool hasTemperature;
    int16_t temperatureHundredthsC;
    Mode mode;
};

// Real payloads from laser 1, captured with nRF Connect and the laptop logger.
static const Capture Captures[] = {
    {"19 mm, Live Stream", "5054A1E54C66F9E13313001D020AE803B70703", true, 19, true, 1000, true, 1975, Mode::LiveStream},
    {"no reading", "5054A1E54C66F9E1330000000000FFFF008001", false, 0, false, 0, false, 0, Mode::Smart},
    {"133 mm, Smart", "5054A1E54C66F9E1338500AB010AE8031B0801", true, 133, true, 1000, true, 2075, Mode::Smart},
    {"368 mm, old batteries", "5054A1E54C66F9E1337001C0000A5103850701", true, 368, true, 849, true, 1925, Mode::Smart},
    {"193 mm, Session", "5054A1E54C66F9E133C1006F010A5703210702", true, 193, true, 855, true, 1825, Mode::Session},
    {"233 mm, Live Stream with the battery sagging", "5054A1E54C66F9E133E90047010AFF02530703", true, 233, true, 767, true, 1875, Mode::LiveStream},
    {"219 mm, Ultra Low Power", "5054A1E54C66F9E133DB0055010A5B039E0704", true, 219, true, 859, true, 1950, Mode::UltraLowPower},
};

static void testDecodesCaptures()
{
    for (const Capture& capture : Captures)
    {
        Reading reading;
        TEST_ASSERT_TRUE_MESSAGE(decodeHex(capture.hex, reading), capture.name);

        char address[18];
        RaptLaser::formatAddress(reading.address, address);
        TEST_ASSERT_EQUAL_STRING_MESSAGE("E5:4C:66:F9:E1:33", address, capture.name);

        TEST_ASSERT_EQUAL_MESSAGE(capture.hasDistance, reading.hasDistance, capture.name);
        TEST_ASSERT_EQUAL_UINT16_MESSAGE(capture.distanceMm, reading.distanceMm, capture.name);
        TEST_ASSERT_EQUAL_MESSAGE(capture.hasBattery, reading.hasBattery, capture.name);
        TEST_ASSERT_EQUAL_UINT16_MESSAGE(capture.batteryTenthsPercent, reading.batteryTenthsPercent, capture.name);
        TEST_ASSERT_EQUAL_MESSAGE(capture.hasTemperature, reading.hasTemperature, capture.name);
        TEST_ASSERT_EQUAL_INT16_MESSAGE(capture.temperatureHundredthsC, reading.temperatureHundredthsC, capture.name);
        TEST_ASSERT_EQUAL_MESSAGE(static_cast<int>(capture.mode), static_cast<int>(reading.mode), capture.name);
    }
}

static void testDecodesTemperatureBelowZero()
{
    // 0xFF06 is -250 as a signed value
    char hex[64];
    strcpy(hex, Payload133);
    memcpy(strstr(hex, "1B08"), "06FF", 4);

    Reading reading;
    TEST_ASSERT_TRUE(decodeHex(hex, reading));
    TEST_ASSERT_EQUAL_INT16(-250, reading.temperatureHundredthsC);
}

static void testGivesUnknownForNewMode()
{
    char hex[64];
    strcpy(hex, Payload133);
    memcpy(hex + strlen(hex) - 2, "09", 2);

    Reading reading;
    TEST_ASSERT_TRUE(decodeHex(hex, reading));
    TEST_ASSERT_EQUAL(static_cast<int>(Mode::Unknown), static_cast<int>(reading.mode));
    TEST_ASSERT_EQUAL_STRING("unknown", RaptLaser::modeName(reading.mode));
}

static void testRejectsWrongLength()
{
    char hex[64];
    Reading reading;

    strcpy(hex, Payload133);
    hex[strlen(hex) - 2] = 0;
    TEST_ASSERT_FALSE(decodeHex(hex, reading));

    strcpy(hex, Payload133);
    strcat(hex, "00");
    TEST_ASSERT_FALSE(decodeHex(hex, reading));
}

static void testRejectsDifferentSignature()
{
    char hex[64];
    strcpy(hex, Payload133);
    memcpy(hex, "5055", 4);

    Reading reading;
    TEST_ASSERT_FALSE(decodeHex(hex, reading));
}

static void testRejectsOtherRaptDevice()
{
    char hex[64];
    strcpy(hex, Payload133);
    memcpy(hex, "505402", 6);

    Reading reading;
    TEST_ASSERT_FALSE(decodeHex(hex, reading));
}

static void testDecodesManufacturerData()
{
    char hex[64];
    uint8_t bytes[64];
    Reading reading;

    snprintf(hex, sizeof(hex), "5241%s", Payload133);
    TEST_ASSERT_TRUE(RaptLaser::decodeManufacturerData(bytes, hexToBytes(hex, bytes), reading));
    TEST_ASSERT_EQUAL_UINT16(133, reading.distanceMm);

    // Apple's company ID
    snprintf(hex, sizeof(hex), "4C00%s", Payload133);
    TEST_ASSERT_FALSE(RaptLaser::decodeManufacturerData(bytes, hexToBytes(hex, bytes), reading));

    TEST_ASSERT_FALSE(RaptLaser::decodeManufacturerData(bytes, 1, reading));
}

static void testModeNames()
{
    TEST_ASSERT_EQUAL_STRING("Smart", RaptLaser::modeName(Mode::Smart));
    TEST_ASSERT_EQUAL_STRING("Session", RaptLaser::modeName(Mode::Session));
    TEST_ASSERT_EQUAL_STRING("Live Stream", RaptLaser::modeName(Mode::LiveStream));
    TEST_ASSERT_EQUAL_STRING("Ultra Low Power", RaptLaser::modeName(Mode::UltraLowPower));
}

static void testParsesAddress()
{
    uint8_t address[6];

    TEST_ASSERT_TRUE(RaptLaser::parseAddress("E5:4C:66:F9:E1:33", address));
    char text[18];
    RaptLaser::formatAddress(address, text);
    TEST_ASSERT_EQUAL_STRING("E5:4C:66:F9:E1:33", text);

    TEST_ASSERT_TRUE(RaptLaser::parseAddress("c4:a3:df:a2:c5:1b", address));
    RaptLaser::formatAddress(address, text);
    TEST_ASSERT_EQUAL_STRING("C4:A3:DF:A2:C5:1B", text);
}

static void testRejectsBadAddress()
{
    const char* bad[] = {
        "",
        "E5:4C:66:F9:E1",
        "E5:4C:66:F9:E1:3",
        "E5:4C:66:F9:E1:33:",
        "E5:4C:66:F9:E1:33 ",
        "E54C66F9E133",
        "E5-4C-66-F9-E1-33",
        "G5:4C:66:F9:E1:33",
    };

    for (const char* text : bad)
    {
        uint8_t address[6] = {1, 2, 3, 4, 5, 6};
        TEST_ASSERT_FALSE_MESSAGE(RaptLaser::parseAddress(text, address), text);
        // Left unchanged
        TEST_ASSERT_EQUAL_UINT8_MESSAGE(1, address[0], text);
        TEST_ASSERT_EQUAL_UINT8_MESSAGE(6, address[5], text);
    }
}

struct ShownLevel
{
    uint16_t distanceMm;
    uint16_t litresTenths;
    uint8_t percent;
};

// What the tap shows at readings from the jug calibration on 2026-11-16, with
// what was in the keg alongside.

// The bottom 3 L with the float's ball in the beam: what's there. The second
// filling's readings 25 mm closer, then two readings with the ball seen there.
static const ShownLevel BallInTheBeam[] = {
    {539, 0, 0},    // 0 L
    {532, 5, 2},    // 0.5 L
    {508, 10, 5},   // 1 L
    {494, 15, 7},   // 1.5 L
    {477, 20, 10},  // 2 L
    {457, 25, 13},  // 2.5 L
    {440, 30, 15},  // 3 L
    {548, 0, 0},    // 0 L, the ball on the bottom
    {508, 10, 5},   // 1.5 L, the ball floating
};

// The bottom 3 L with the ball out of the way: less, never more. The second
// filling, with the float tied up.
static const ShownLevel BallOutOfTheWay[] = {
    {564, 0, 0},    // 0 L
    {557, 0, 0},    // 0.5 L
    {533, 4, 2},    // 1 L
    {519, 7, 4},    // 1.5 L
    {502, 12, 6},   // 2 L
    {482, 18, 9},   // 2.5 L
    {465, 23, 12},  // 3 L
};

// The straight part, from the first filling.
static const ShownLevel StraightPart[] = {
    {402, 48, 25},   // 5 L
    {343, 70, 37},   // 7 L
    {288, 90, 47},   // 9 L
    {236, 109, 57},  // 11 L
    {180, 130, 68},  // 13 L
    {126, 150, 79},  // 15 L
    {110, 156, 82},  // 15.5 L
    {97, 160, 84},   // 16 L
    {85, 165, 87},   // 16.5 L
    {72, 170, 89},   // 17 L
    {58, 175, 92},   // 17.5 L
    {49, 178, 93},   // 18 L
    {32, 188, 99},   // 18.5 L
    {29, 190, 100},  // 19 L
};

// Between the points, beyond empty and nearer than full.
static const ShownLevel OtherLevels[] = {
    // Halfway between the points for 1 L and 1.5 L
    {501, 12, 6},
    // Half of 19 L, on the straight line
    {276, 95, 50},
    {540, 0, 0},
    {600, 0, 0},
    // What the laser read with the lid off
    {21, 190, 100},
    {0, 190, 100},
};

static void checkLevels(const ShownLevel* levels, size_t count)
{
    for (size_t i = 0; i < count; i++)
    {
        const ShownLevel& expected = levels[i];
        char message[24];
        snprintf(message, sizeof(message), "%u mm", expected.distanceMm);

        RaptLaser::KegLevel level = RaptLaser::kegLevel(expected.distanceMm);
        TEST_ASSERT_EQUAL_UINT16_MESSAGE(expected.litresTenths, level.litresTenths, message);
        TEST_ASSERT_EQUAL_UINT8_MESSAGE(expected.percent, level.percent, message);
    }
}

#define CHECK_LEVELS(levels) checkLevels(levels, sizeof(levels) / sizeof(levels[0]))

static void testKegLevelWithTheBallInTheBeam()
{
    CHECK_LEVELS(BallInTheBeam);
}

static void testKegLevelWithTheBallOutOfTheWay()
{
    CHECK_LEVELS(BallOutOfTheWay);
}

static void testKegLevelInTheStraightPart()
{
    CHECK_LEVELS(StraightPart);
}

static void testKegLevelBetweenAndBeyondThePoints()
{
    CHECK_LEVELS(OtherLevels);
}

static void testKegCapacity()
{
    TEST_ASSERT_EQUAL_UINT16(190, RaptLaser::Corny19L.capacityTenthsLitres());
}

static void testKegLevelWithAnotherCalibration()
{
    static const RaptLaser::KegPoint points[] = {{300, 0}, {20, 95}};

    // Half of 9.5 L is 4.75, shown as 4.7
    RaptLaser::KegLevel level = RaptLaser::kegLevel(160, {points, 2});

    TEST_ASSERT_EQUAL_UINT16(47, level.litresTenths);
    TEST_ASSERT_EQUAL_UINT8(50, level.percent);
}

static void testKegLevelWithInvalidCalibration()
{
    static const RaptLaser::KegPoint distancesUp[] = {{22, 0}, {552, 190}};
    static const RaptLaser::KegPoint litresDown[] = {{552, 190}, {22, 0}};
    static const RaptLaser::KegPoint onePoint[] = {{552, 0}};
    const RaptLaser::KegCalibration calibrations[] = {
        {distancesUp, 2},
        {litresDown, 2},
        {onePoint, 1},
        {nullptr, 0},
    };

    for (const RaptLaser::KegCalibration& keg : calibrations)
    {
        RaptLaser::KegLevel level = RaptLaser::kegLevel(100, keg);

        TEST_ASSERT_EQUAL_UINT16(0, level.litresTenths);
        TEST_ASSERT_EQUAL_UINT8(0, level.percent);
    }
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(testDecodesCaptures);
    RUN_TEST(testDecodesTemperatureBelowZero);
    RUN_TEST(testGivesUnknownForNewMode);
    RUN_TEST(testRejectsWrongLength);
    RUN_TEST(testRejectsDifferentSignature);
    RUN_TEST(testRejectsOtherRaptDevice);
    RUN_TEST(testDecodesManufacturerData);
    RUN_TEST(testModeNames);
    RUN_TEST(testParsesAddress);
    RUN_TEST(testRejectsBadAddress);
    RUN_TEST(testKegLevelWithTheBallInTheBeam);
    RUN_TEST(testKegLevelWithTheBallOutOfTheWay);
    RUN_TEST(testKegLevelInTheStraightPart);
    RUN_TEST(testKegLevelBetweenAndBeyondThePoints);
    RUN_TEST(testKegCapacity);
    RUN_TEST(testKegLevelWithAnotherCalibration);
    RUN_TEST(testKegLevelWithInvalidCalibration);
    return UNITY_END();
}
