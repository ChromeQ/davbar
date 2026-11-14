// Runs on the laptop: pio test -d esp32 -e native
// Draws strips like the agreed mock-ups and checks the colours in each part.
// With STRIP_TEST_OUTPUT set to a folder, each strip is also saved there as
// <name>.bin (400 x 200, 2 pixels a byte) to look at.

#include <Strip.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unity.h>

using Strip::Colour;

static uint8_t strip[Strip::Size];

void setUp() {}

void tearDown() {}

static Strip::Values fullKeg()
{
    Strip::Values values = {};
    values.laserChosen = true;
    values.laserNumber = 2;
    values.mode = Strip::Mode::Smart;
    values.hasLevel = true;
    values.percent = 62;
    values.litresTenths = 117;
    values.hasTemperature = true;
    values.temperatureTenths = 183;
    values.hasBattery = true;
    values.batteryPercent = 100;
    return values;
}

static void drawAndSave(const char* name, const Strip::Values& values)
{
    Strip::draw(strip, values);

    const char* folder = getenv("STRIP_TEST_OUTPUT");
    if (!folder)
    {
        return;
    }

    char path[512];
    snprintf(path, sizeof(path), "%s/%s.bin", folder, name);
    FILE* file = fopen(path, "wb");
    TEST_ASSERT_NOT_NULL_MESSAGE(file, path);
    fwrite(strip, 1, sizeof(strip), file);
    fclose(file);
}

static uint8_t pixel(int x, int y)
{
    uint8_t byte = strip[y * Strip::RowBytes + x / 2];
    return x % 2 == 0 ? byte >> 4 : byte & 0x0F;
}

// A bit for each colour found in the area.
static unsigned coloursIn(int x, int y, int width, int height)
{
    unsigned found = 0;
    for (int j = y; j < y + height; j++)
    {
        for (int i = x; i < x + width; i++)
        {
            found |= 1u << pixel(i, j);
        }
    }

    return found;
}

static unsigned bit(Colour colour)
{
    return 1u << colour;
}

// The bar's inside is x 20-379 and y 92-179.
static const int BarInsideX = 20;
static const int BarInsideY = 92;
static const int BarInsideWidth = 360;
static const int BarInsideHeight = 88;

static void testBarTextSplitsAtTheFill()
{
    drawAndSave("full-keg", fullKeg());

    int fill = (BarInsideWidth * 62 + 50) / 100;
    TEST_ASSERT_EQUAL_UINT8(Strip::Black, pixel(16, 88));
    // The filled part holds the green fill and white text, and no black text.
    // The empty part holds the white background and black text, and no green.
    TEST_ASSERT_EQUAL_HEX(
        bit(Strip::Green) | bit(Strip::White),
        coloursIn(BarInsideX, BarInsideY, fill, BarInsideHeight)
    );
    TEST_ASSERT_EQUAL_HEX(
        bit(Strip::White) | bit(Strip::Black),
        coloursIn(BarInsideX + fill, BarInsideY, BarInsideWidth - fill, BarInsideHeight)
    );
}

static void testOrangeIsTwoRedToOneYellow()
{
    Strip::Values values = fullKeg();
    values.percent = 40;
    values.litresTenths = 76;
    drawAndSave("orange", values);

    // Left of the litres, so no text.
    for (int y = BarInsideY; y < BarInsideY + BarInsideHeight; y++)
    {
        for (int x = BarInsideX; x < BarInsideX + 60; x++)
        {
            uint8_t expected = (x + y) % 3 == 0 ? Strip::Yellow : Strip::Red;
            TEST_ASSERT_EQUAL_UINT8(expected, pixel(x, y));
        }
    }
}

static void testRedBarLeavesTheLitresOnWhite()
{
    Strip::Values values = fullKeg();
    values.percent = 15;
    values.litresTenths = 28;
    drawAndSave("red", values);

    int fill = (BarInsideWidth * 15 + 50) / 100;
    TEST_ASSERT_EQUAL_HEX(bit(Strip::Red), coloursIn(BarInsideX, BarInsideY, fill, BarInsideHeight));
}

static void testLowBatteryIsRedWithItsPercentage()
{
    Strip::Values values = fullKeg();
    values.batteryPercent = 7;
    values.laserNumber = 3;
    drawAndSave("low-battery", values);

    // The battery sits at x 160-215 and y 31-56 in the middle group.
    unsigned colours = coloursIn(160, 31, 56, 26);
    TEST_ASSERT_TRUE(colours & bit(Strip::Red));
    TEST_ASSERT_TRUE(colours & bit(Strip::White));
    TEST_ASSERT_FALSE(colours & bit(Strip::Black));
    TEST_ASSERT_FALSE(colours & bit(Strip::Green));
}

static void testNoSignalHidesTheModeWarning()
{
    Strip::Values values = fullKeg();
    values.mode = Strip::Mode::Eco;
    values.modeWarning = true;
    drawAndSave("mode-warning", values);
    TEST_ASSERT_TRUE(coloursIn(0, 0, Strip::Width, 80) & bit(Strip::Yellow));

    values.noSignal = true;
    drawAndSave("no-signal", values);
    unsigned colours = coloursIn(0, 0, Strip::Width, 80);
    TEST_ASSERT_FALSE(colours & bit(Strip::Yellow));
    // A blue Bluetooth symbol with a red line through it.
    TEST_ASSERT_TRUE(colours & bit(Strip::Blue));
    TEST_ASSERT_TRUE(colours & bit(Strip::Red));
}

// The bounds of the pixels of one colour in an area, or of everything but white.
struct Ink
{
    int left;
    int top;
    int right;
    int bottom;
};

static const int AnyInk = -1;

static Ink inkIn(int x, int y, int width, int height, int colour = AnyInk)
{
    Ink ink = {x + width, y + height, x - 1, y - 1};
    for (int j = y; j < y + height; j++)
    {
        for (int i = x; i < x + width; i++)
        {
            uint8_t found = pixel(i, j);
            bool counts = colour == AnyInk ? found != Strip::White : found == colour;
            if (counts)
            {
                ink.left = i < ink.left ? i : ink.left;
                ink.right = i > ink.right ? i : ink.right;
                ink.top = j < ink.top ? j : ink.top;
                ink.bottom = j > ink.bottom ? j : ink.bottom;
            }
        }
    }

    return ink;
}

static Strip::Values noReading()
{
    Strip::Values values = {};
    values.laserChosen = true;
    values.laserNumber = 1;
    return values;
}

// The shrug in the bar, centred in its inside to within a pixel, as an odd space
// can't split evenly.
static void assertShrugInTheBar()
{
    TEST_ASSERT_EQUAL_HEX(
        bit(Strip::White) | bit(Strip::Black),
        coloursIn(BarInsideX, BarInsideY, BarInsideWidth, BarInsideHeight)
    );

    Ink shrug = inkIn(BarInsideX, BarInsideY, BarInsideWidth, BarInsideHeight);
    TEST_ASSERT_INT_WITHIN(1, shrug.left - BarInsideX, BarInsideX + BarInsideWidth - 1 - shrug.right);
    TEST_ASSERT_INT_WITHIN(1, shrug.top - BarInsideY, BarInsideY + BarInsideHeight - 1 - shrug.bottom);
}

// "Waiting for laser 1" across the row, in place of the values, centred to
// within a few pixels, as each end's letter has its own space beside it.
static void testWaitingForTheFirstReading()
{
    drawAndSave("waiting", noReading());

    TEST_ASSERT_EQUAL_HEX(
        bit(Strip::White) | bit(Strip::Black),
        coloursIn(0, 0, Strip::Width, Strip::Height)
    );
    Ink message = inkIn(0, 0, Strip::Width, 88);
    TEST_ASSERT_LESS_THAN(50, message.left);
    TEST_ASSERT_GREATER_THAN(350, message.right);
    TEST_ASSERT_INT_WITHIN(6, Strip::Width - 1, message.left + message.right);
    assertShrugInTheBar();
}

// A laser not in config/lasers.json has no number to give.
static void testWaitingForALaserWithNoNumber()
{
    Strip::draw(strip, noReading());
    int withNumber = inkIn(0, 0, Strip::Width, 88).right - inkIn(0, 0, Strip::Width, 88).left;

    Strip::Values values = noReading();
    values.laserNumber = 0;
    drawAndSave("waiting-no-number", values);
    Ink message = inkIn(0, 0, Strip::Width, 88);

    TEST_ASSERT_LESS_THAN(withNumber - 20, message.right - message.left);
    assertShrugInTheBar();
}

// The mode warning, which may be why there's no reading yet, goes in front.
static void testWaitingShowsTheModeWarning()
{
    Strip::Values values = noReading();
    values.modeWarning = true;
    drawAndSave("waiting-mode-warning", values);

    // The sign at the left end, and all of it clear of the test border.
    Ink sign = inkIn(0, 0, Strip::Width, 88, Strip::Yellow);
    Ink row = inkIn(0, 0, Strip::Width, 88);
    TEST_ASSERT_INT_WITHIN(3, row.left, sign.left);
    TEST_ASSERT_GREATER_OR_EQUAL(Strip::TestBorder, row.left);
    TEST_ASSERT_LESS_THAN(Strip::Width - Strip::TestBorder, row.right);
    TEST_ASSERT_GREATER_THAN(350, row.right);
}

// No reading, and nothing heard: "Can't hear laser 1", with the no signal icon in
// front.
static void testCantHearALaserNeverHeard()
{
    Strip::Values values = noReading();
    values.noSignal = true;
    values.modeWarning = true;
    drawAndSave("never-heard", values);

    TEST_ASSERT_EQUAL_HEX(
        bit(Strip::White) | bit(Strip::Black) | bit(Strip::Blue) | bit(Strip::Red),
        coloursIn(0, 0, Strip::Width, 88)
    );
    Ink icon = inkIn(0, 0, Strip::Width, 88, Strip::Blue);
    Ink text = inkIn(0, 0, Strip::Width, 88, Strip::Black);
    TEST_ASSERT_LESS_THAN(text.left, icon.right);
    assertShrugInTheBar();
}

// Nothing heard after a reading: the message in place of the row's values, which
// are as old as the level, and the bar keeping the last level.
static void testCantHearALaserKeepsTheLevel()
{
    Strip::Values values = fullKeg();
    values.noSignal = true;
    drawAndSave("cant-hear", values);

    unsigned row = coloursIn(0, 0, Strip::Width, 88);
    // No battery fill
    TEST_ASSERT_FALSE(row & bit(Strip::Green));
    TEST_ASSERT_TRUE(row & bit(Strip::Blue));

    static uint8_t withSignal[Strip::Size];
    Strip::draw(withSignal, fullKeg());
    TEST_ASSERT_EQUAL_MEMORY(
        withSignal + 88 * Strip::RowBytes,
        strip + 88 * Strip::RowBytes,
        (Strip::Height - 88) * Strip::RowBytes
    );
}

static void testNoLaserShowsOnlyText()
{
    Strip::Values values = {};
    drawAndSave("no-laser", values);

    TEST_ASSERT_EQUAL_HEX(
        bit(Strip::White) | bit(Strip::Black),
        coloursIn(0, 0, Strip::Width, Strip::Height)
    );
    // No bar outline.
    TEST_ASSERT_EQUAL_UINT8(Strip::White, pixel(16, 88));
}

// The first and last rows with anything drawn, in the given columns above the bar.
static void inkRows(int x, int width, int& top, int& bottom)
{
    top = 0;
    while (top < 88 && coloursIn(x, top, width, 1) == bit(Strip::White))
    {
        top++;
    }

    bottom = 87;
    while (bottom > 0 && coloursIn(x, bottom, width, 1) == bit(Strip::White))
    {
        bottom--;
    }
}

// Centred between the image (above y 0) and the bar (from y 88), to within a
// pixel, as an odd space can't split evenly.
static void testTopRowIsCentredAboveTheBar()
{
    drawAndSave("full-keg", fullKeg());

    // The "62%" on the left, then the middle group.
    const int columns[][2] = {{0, 130}, {130, 140}};
    for (const auto& column : columns)
    {
        int top;
        int bottom;
        inkRows(column[0], column[1], top, bottom);
        int above = top;
        int below = 88 - 1 - bottom;
        TEST_ASSERT_INT_WITHIN(1, above, below);
    }
}

static void testTestValuesHaveARedBorder()
{
    Strip::Values values = fullKeg();
    Strip::draw(strip, values);
    static uint8_t live[Strip::Size];
    memcpy(live, strip, sizeof(live));

    values.test = true;
    drawAndSave("test-values", values);

    for (int y = 0; y < Strip::Height; y++)
    {
        for (int x = 0; x < Strip::Width; x++)
        {
            bool border = x < 5 || x >= Strip::Width - 5 || y < 5 || y >= Strip::Height - 5;
            if (border)
            {
                TEST_ASSERT_EQUAL_UINT8(Strip::Red, pixel(x, y));
            }
            else
            {
                // Everything inside is exactly as it was.
                uint8_t byte = live[y * Strip::RowBytes + x / 2];
                TEST_ASSERT_EQUAL_UINT8(x % 2 == 0 ? byte >> 4 : byte & 0x0F, pixel(x, y));
            }
        }
    }
}

// CRC-32, the same as zlib's, which the web app's test uses.
static uint32_t crc32(const uint8_t* data, size_t length)
{
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < length; i++)
    {
        crc ^= data[i];
        for (int bit = 0; bit < 8; bit++)
        {
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1)));
        }
    }

    return ~crc;
}

// The web app draws the strip too, for its preview (app/web/src/strip.ts). It
// draws these same strips in app/web/src/strip.test.ts and checks them against
// the same CRC-32s, so the preview matches the screen. After changing how the
// strip looks, update the numbers in both tests.
static void testMatchesTheWebAppsPreview()
{
    struct Case
    {
        const char* name;
        Strip::Values values;
        uint32_t crc;
    };

    Strip::Values full = fullKeg();

    Strip::Values orange = full;
    orange.percent = 40;
    orange.litresTenths = 76;

    Strip::Values red = full;
    red.percent = 15;
    red.litresTenths = 28;

    Strip::Values lowBattery = full;
    lowBattery.laserNumber = 3;
    lowBattery.batteryPercent = 7;

    Strip::Values modeWarning = full;
    modeWarning.mode = Strip::Mode::Eco;
    modeWarning.modeWarning = true;

    Strip::Values noSignal = modeWarning;
    noSignal.noSignal = true;

    Strip::Values fullAndCold = full;
    fullAndCold.laserNumber = 1;
    fullAndCold.percent = 100;
    fullAndCold.litresTenths = 190;
    fullAndCold.temperatureTenths = -15;
    fullAndCold.batteryPercent = 55;

    Strip::Values test = full;
    test.test = true;

    Strip::Values noLaser = {};

    Strip::Values waiting = noReading();

    Strip::Values noNumber = waiting;
    noNumber.laserNumber = 0;

    Strip::Values waitingWarning = waiting;
    waitingWarning.modeWarning = true;

    Strip::Values neverHeard = waitingWarning;
    neverHeard.noSignal = true;

    const Case cases[] = {
        {"full keg", full, 0x8A974B40},
        {"orange", orange, 0x5BBB82C2},
        {"red", red, 0x50AAE884},
        {"low battery", lowBattery, 0x53E20D63},
        {"mode warning", modeWarning, 0x2889C7DD},
        {"no signal", noSignal, 0xB4A55ABB},
        {"full and cold", fullAndCold, 0xA4FD7742},
        {"test values", test, 0x227369F7},
        {"no laser", noLaser, 0x15D02483},
        {"waiting", waiting, 0xF24CD5D5},
        {"waiting, no number", noNumber, 0x3C88CEDF},
        {"waiting, mode warning", waitingWarning, 0x30F6B2D2},
        {"never heard", neverHeard, 0x6A2A49B4},
    };

    // All printed first (pio test -v shows them), then checked.
    const size_t count = sizeof(cases) / sizeof(cases[0]);
    uint32_t crcs[count];
    for (size_t i = 0; i < count; i++)
    {
        Strip::draw(strip, cases[i].values);
        crcs[i] = crc32(strip, Strip::Size);
        printf("%s: 0x%08X\n", cases[i].name, crcs[i]);
    }

    for (size_t i = 0; i < count; i++)
    {
        TEST_ASSERT_EQUAL_HEX32_MESSAGE(cases[i].crc, crcs[i], cases[i].name);
    }
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(testBarTextSplitsAtTheFill);
    RUN_TEST(testOrangeIsTwoRedToOneYellow);
    RUN_TEST(testRedBarLeavesTheLitresOnWhite);
    RUN_TEST(testLowBatteryIsRedWithItsPercentage);
    RUN_TEST(testNoSignalHidesTheModeWarning);
    RUN_TEST(testNoLaserShowsOnlyText);
    RUN_TEST(testTopRowIsCentredAboveTheBar);
    RUN_TEST(testTestValuesHaveARedBorder);
    RUN_TEST(testWaitingForTheFirstReading);
    RUN_TEST(testWaitingForALaserWithNoNumber);
    RUN_TEST(testWaitingShowsTheModeWarning);
    RUN_TEST(testCantHearALaserNeverHeard);
    RUN_TEST(testCantHearALaserKeepsTheLevel);
    RUN_TEST(testMatchesTheWebAppsPreview);
    return UNITY_END();
}
