// Runs on the laptop: pio test -d esp32 -e native
// The captures and RAPT app readings match app/rapt-laser/tests, so the C++ and
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

struct AppReading
{
    uint16_t distanceMm;
    uint16_t litresTenths;
    uint8_t percent;
};

// Distances and volumes read from the RAPT app, plus full, empty and beyond.
static const AppReading AppReadings[] = {
    {17, 190, 100},
    {133, 150, 79},
    {134, 149, 78},
    {135, 149, 78},
    {136, 149, 78},
    {250, 108, 56},
    {359, 69, 36},
    {22, 190, 100},
    {552, 0, 0},
    {600, 0, 0},
    // 106 mm of beer is exactly 3.8 L and 20%
    {446, 38, 20},
};

static void testKegLevelMatchesRaptApp()
{
    for (const AppReading& expected : AppReadings)
    {
        char message[24];
        snprintf(message, sizeof(message), "%u mm", expected.distanceMm);

        RaptLaser::KegLevel level = RaptLaser::kegLevel(expected.distanceMm);
        TEST_ASSERT_EQUAL_UINT16_MESSAGE(expected.litresTenths, level.litresTenths, message);
        TEST_ASSERT_EQUAL_UINT8_MESSAGE(expected.percent, level.percent, message);
    }
}

static void testKegLevelWithAnotherCalibration()
{
    // Half of 9.5 L is 4.75, shown as 4.7
    RaptLaser::KegLevel level = RaptLaser::kegLevel(160, {95, 300, 20});

    TEST_ASSERT_EQUAL_UINT16(47, level.litresTenths);
    TEST_ASSERT_EQUAL_UINT8(50, level.percent);
}

static void testKegLevelWithInvalidCalibration()
{
    RaptLaser::KegLevel level = RaptLaser::kegLevel(100, {190, 22, 552});

    TEST_ASSERT_EQUAL_UINT16(0, level.litresTenths);
    TEST_ASSERT_EQUAL_UINT8(0, level.percent);
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
    RUN_TEST(testKegLevelMatchesRaptApp);
    RUN_TEST(testKegLevelWithAnotherCalibration);
    RUN_TEST(testKegLevelWithInvalidCalibration);
    return UNITY_END();
}
