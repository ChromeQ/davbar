// Where the picture goes: the square above the strip, or the whole screen on a
// tap with no laser on purpose. Run from esp32/: pio test -e native -f test_screen_layout

#include <ScreenLayout.h>
#include <string.h>
#include <unity.h>

#include <vector>

void setUp() {}

void tearDown() {}

using ScreenLayout::BandBytes;
using ScreenLayout::ScreenBytes;
using ScreenLayout::SquareBytes;

void testSizes()
{
    TEST_ASSERT_EQUAL(120000, ScreenBytes);
    TEST_ASSERT_EQUAL(80000, SquareBytes);
    TEST_ASSERT_EQUAL(SquareBytes + BandBytes * 2, ScreenBytes);

    TEST_ASSERT_TRUE(ScreenLayout::pictureSize(80000));
    TEST_ASSERT_TRUE(ScreenLayout::pictureSize(120000));
    TEST_ASSERT_FALSE(ScreenLayout::pictureSize(0));
    TEST_ASSERT_FALSE(ScreenLayout::pictureSize(100000));
}

void testWholeScreenOnlyWithNoLaserOnPurpose()
{
    TEST_ASSERT_TRUE(ScreenLayout::wholeScreen(true, false));
    // A laser, or none chosen yet (the strip asks for one)
    TEST_ASSERT_FALSE(ScreenLayout::wholeScreen(false, false));
    // Test values show their strip, whatever the laser.
    TEST_ASSERT_FALSE(ScreenLayout::wholeScreen(true, true));
    TEST_ASSERT_FALSE(ScreenLayout::wholeScreen(false, true));
}

// A screen's bytes after placing a picture whose rows each start with their own
// number, in two bytes, so where each row ended up can be read back.
std::vector<uint8_t> placed(size_t pictureBytes, bool whole)
{
    std::vector<uint8_t> picture(pictureBytes, 0x55);
    for (size_t y = 0; y < pictureBytes / ScreenLayout::RowBytes; y++)
    {
        picture[y * ScreenLayout::RowBytes] = static_cast<uint8_t>(y & 0xFF);
        picture[y * ScreenLayout::RowBytes + 1] = static_cast<uint8_t>(y >> 8);
    }

    // 0xEE where nothing was put
    std::vector<uint8_t> screen(ScreenBytes, 0xEE);
    ScreenLayout::Placement place = ScreenLayout::place(pictureBytes, whole);
    TEST_ASSERT_LESS_OR_EQUAL(pictureBytes, place.from + place.length);
    TEST_ASSERT_LESS_OR_EQUAL(ScreenBytes, place.to + place.length);
    memcpy(screen.data() + place.to, picture.data() + place.from, place.length);
    if (place.whiteBands)
    {
        memset(screen.data(), 0x11, BandBytes);
        memset(screen.data() + BandBytes + SquareBytes, 0x11, BandBytes);
    }
    return screen;
}

// The picture's row number at this row of the screen. White is 0x1111, and
// nothing put there 0xEEEE.
unsigned row(const std::vector<uint8_t>& screen, size_t y)
{
    return screen[y * ScreenLayout::RowBytes] | (screen[y * ScreenLayout::RowBytes + 1] << 8);
}

const unsigned White = 0x1111;
const unsigned Untouched = 0xEEEE;

void testWholePictureOnTheWholeScreen()
{
    std::vector<uint8_t> screen = placed(ScreenBytes, true);
    TEST_ASSERT_EQUAL(0, row(screen, 0));
    TEST_ASSERT_EQUAL(300, row(screen, 300));
    TEST_ASSERT_EQUAL(599, row(screen, 599));
}

void testWholePictureWithAStripShowsItsMiddleSquare()
{
    std::vector<uint8_t> screen = placed(ScreenBytes, false);
    // The picture's rows 100 to 499 in the screen's top 400 rows
    TEST_ASSERT_EQUAL(100, row(screen, 0));
    TEST_ASSERT_EQUAL(499, row(screen, 399));
    // The strip's rows are left for the strip.
    TEST_ASSERT_EQUAL(Untouched, row(screen, 400));
    TEST_ASSERT_EQUAL(Untouched, row(screen, 599));
}

void testSquarePictureWithAStrip()
{
    std::vector<uint8_t> screen = placed(SquareBytes, false);
    TEST_ASSERT_EQUAL(0, row(screen, 0));
    TEST_ASSERT_EQUAL(399, row(screen, 399));
    TEST_ASSERT_EQUAL(Untouched, row(screen, 400));
}

void testSquarePictureOnTheWholeScreenSitsInTheMiddleOnWhite()
{
    std::vector<uint8_t> screen = placed(SquareBytes, true);
    TEST_ASSERT_EQUAL(White, row(screen, 0));
    TEST_ASSERT_EQUAL(White, row(screen, 99));
    TEST_ASSERT_EQUAL(0, row(screen, 100));
    TEST_ASSERT_EQUAL(399, row(screen, 499));
    TEST_ASSERT_EQUAL(White, row(screen, 500));
    TEST_ASSERT_EQUAL(White, row(screen, 599));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(testSizes);
    RUN_TEST(testWholeScreenOnlyWithNoLaserOnPurpose);
    RUN_TEST(testWholePictureOnTheWholeScreen);
    RUN_TEST(testWholePictureWithAStripShowsItsMiddleSquare);
    RUN_TEST(testSquarePictureWithAStrip);
    RUN_TEST(testSquarePictureOnTheWholeScreenSitsInTheMiddleOnWhite);
    return UNITY_END();
}
