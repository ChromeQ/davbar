// Where the picture goes: the square above the strip, or the whole screen on a
// tap with no laser on purpose, and each tap's fit to its case. Run from esp32/:
// pio test -e native -f test_screen_layout

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

// The colour code of one pixel of the screen's bytes, 2 pixels a byte.
uint8_t pixel(const std::vector<uint8_t>& screen, int x, int y)
{
    uint8_t byte = screen[y * ScreenLayout::RowBytes + x / 2];
    return x % 2 == 0 ? byte >> 4 : byte & 0x0F;
}

void testTestBorderGoesRoundTheWholeScreen()
{
    const uint8_t white = 0x1;
    const uint8_t red = 0x3;
    const int border = 5;
    // Just inside what the case's frame hides (Strip::HiddenX and HiddenY)
    const int left = 14;
    const int top = 9;

    // Every edge, 5 pixels wide, and nothing inside: no line between the square
    // and the strip.
    std::vector<uint8_t> screen(ScreenBytes, 0x11);
    ScreenLayout::drawTestBorder(screen.data());
    TEST_ASSERT_EQUAL(white, pixel(screen, 0, 0));
    TEST_ASSERT_EQUAL(white, pixel(screen, left - 1, 300));
    TEST_ASSERT_EQUAL(red, pixel(screen, left, top));
    TEST_ASSERT_EQUAL(red, pixel(screen, left + border - 1, 300));
    TEST_ASSERT_EQUAL(white, pixel(screen, left + border, 300));
    TEST_ASSERT_EQUAL(red, pixel(screen, 399 - left, 300));
    TEST_ASSERT_EQUAL(white, pixel(screen, 400 - left, 300));
    TEST_ASSERT_EQUAL(white, pixel(screen, 200, top - 1));
    TEST_ASSERT_EQUAL(red, pixel(screen, 200, top));
    TEST_ASSERT_EQUAL(red, pixel(screen, 200, 599 - top));
    TEST_ASSERT_EQUAL(red, pixel(screen, 200, 599 - top - (border - 1)));
    TEST_ASSERT_EQUAL(white, pixel(screen, 200, 599 - top - border));
    TEST_ASSERT_EQUAL(white, pixel(screen, 200, 599));
    TEST_ASSERT_EQUAL(white, pixel(screen, 200, 399));
    TEST_ASSERT_EQUAL(white, pixel(screen, 200, 400));
}

void setPixel(std::vector<uint8_t>& screen, int x, int y, uint8_t colour)
{
    uint8_t& byte = screen[y * ScreenLayout::RowBytes + x / 2];
    byte = x % 2 == 0 ? (byte & 0x0F) | (colour << 4) : (byte & 0xF0) | colour;
}

// A white screen with marks to follow: a red pixel near the top left, a blue
// one near the bottom right, and a black line across row 500, in the strip.
std::vector<uint8_t> markedScreen()
{
    std::vector<uint8_t> screen(ScreenBytes, 0x11);
    setPixel(screen, 10, 20, 0x3);
    setPixel(screen, 390, 590, 0x5);
    for (int x = 0; x < 400; x++)
    {
        setPixel(screen, x, 500, 0x0);
    }
    return screen;
}

void testNoFitChangesNothing()
{
    std::vector<uint8_t> screen = markedScreen();
    std::vector<uint8_t> before = screen;
    ScreenLayout::applyFit(screen.data(), {0, 0, 0});
    TEST_ASSERT_TRUE(screen == before);
}

void testShiftMovesEverythingByWholePixels()
{
    // 3 right and 7 up, an odd number to cross the halves of a byte
    std::vector<uint8_t> screen = markedScreen();
    ScreenLayout::applyFit(screen.data(), {3, -7, 0});
    TEST_ASSERT_EQUAL(0x3, pixel(screen, 13, 13));
    TEST_ASSERT_EQUAL(0x1, pixel(screen, 10, 20));
    TEST_ASSERT_EQUAL(0x5, pixel(screen, 393, 583));
    TEST_ASSERT_EQUAL(0x0, pixel(screen, 200, 493));
    TEST_ASSERT_EQUAL(0x1, pixel(screen, 200, 500));
    // What opens up at the left repeats the left edge: the line's row is black
    // at the edge, so its first 3 pixels are too.
    TEST_ASSERT_EQUAL(0x0, pixel(screen, 0, 493));
    TEST_ASSERT_EQUAL(0x0, pixel(screen, 2, 493));

    // And back the other way
    screen = markedScreen();
    ScreenLayout::applyFit(screen.data(), {-1, 4, 0});
    TEST_ASSERT_EQUAL(0x3, pixel(screen, 9, 24));
    TEST_ASSERT_EQUAL(0x5, pixel(screen, 389, 594));
    TEST_ASSERT_EQUAL(0x0, pixel(screen, 399, 504));
}

void testBottomSlantFollowsAFrameHigherAtTheRight()
{
    // Tap 1's frame: 6 pixels higher at the right, so the line across the strip
    // goes down 3 at the left edge and up 3 at the right, level in the middle.
    std::vector<uint8_t> screen = markedScreen();
    ScreenLayout::applyFit(screen.data(), {0, 0, 6});
    TEST_ASSERT_EQUAL(0x0, pixel(screen, 0, 503));
    TEST_ASSERT_EQUAL(0x1, pixel(screen, 0, 500));
    TEST_ASSERT_EQUAL(0x0, pixel(screen, 200, 500));
    TEST_ASSERT_EQUAL(0x0, pixel(screen, 399, 497));
    TEST_ASSERT_EQUAL(0x1, pixel(screen, 399, 500));
    // Up a step at a time, never more than one pixel between neighbours
    int previous = 503;
    for (int x = 1; x < 400; x++)
    {
        int y = 490;
        while (pixel(screen, x, y) != 0x0)
        {
            y++;
        }
        TEST_ASSERT_LESS_OR_EQUAL(1, previous - y);
        TEST_ASSERT_GREATER_OR_EQUAL(0, previous - y);
        previous = y;
    }
    // The picture above the strip doesn't move.
    TEST_ASSERT_EQUAL(0x3, pixel(screen, 10, 20));
    // The blue pixel near the bottom right goes up 3 with its column.
    TEST_ASSERT_EQUAL(0x5, pixel(screen, 390, 587));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(testSizes);
    RUN_TEST(testWholePictureOnTheWholeScreen);
    RUN_TEST(testWholePictureWithAStripShowsItsMiddleSquare);
    RUN_TEST(testSquarePictureWithAStrip);
    RUN_TEST(testSquarePictureOnTheWholeScreenSitsInTheMiddleOnWhite);
    RUN_TEST(testTestBorderGoesRoundTheWholeScreen);
    RUN_TEST(testNoFitChangesNothing);
    RUN_TEST(testShiftMovesEverythingByWholePixels);
    RUN_TEST(testBottomSlantFollowsAFrameHigherAtTheRight);
    return UNITY_END();
}
