// The setup help: which screen shows, what its QR code holds, and how it's drawn.
// Run from esp32/: pio test -e native -f test_setup_help
//
// With SETUP_HELP_PREVIEW set to a folder, it also saves both screens there as
// pictures (.ppm), to check by eye. Their QR codes are made up, as the real
// generator is the ESP32's.

#include <SetupHelp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unity.h>

#include <string>
#include <vector>

void setUp() {}

void tearDown() {}

namespace
{
    using SetupHelp::Screen;

    SetupHelp::Details tap2(const char* password = "nine-char")
    {
        return {"Tap 2", "DavBar Tap 2", password, "davbar-tap2.local", "192.168.0.112"};
    }

    // A made-up QR code: the three corner squares, and a pattern between them.
    struct FakeQr
    {
        int size;
        std::vector<uint8_t> modules;

        explicit FakeQr(int qrSize) : size(qrSize), modules(SetupHelp::qrBytes(qrSize), 0)
        {
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    if (finder(x, y) || (!nearFinder(x, y) && (x * 7 + y * 13) % 5 < 2))
                    {
                        int bit = y * size + x;
                        modules[bit / 8] |= 0x80 >> (bit % 8);
                    }
                }
            }
        }

        SetupHelp::QrCode code() const
        {
            return {size, modules.data()};
        }

        bool finder(int x, int y) const
        {
            for (int corner = 0; corner < 3; corner++)
            {
                int left = corner == 1 ? size - 7 : 0;
                int top = corner == 2 ? size - 7 : 0;
                int i = x - left;
                int j = y - top;
                if (i < 0 || i > 6 || j < 0 || j > 6)
                {
                    continue;
                }
                bool ring = i == 0 || i == 6 || j == 0 || j == 6;
                bool centre = i >= 2 && i <= 4 && j >= 2 && j <= 4;
                return ring || centre;
            }
            return false;
        }

        bool nearFinder(int x, int y) const
        {
            return (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
        }
    };

    uint8_t pixel(const uint8_t* image, int x, int y)
    {
        uint8_t byte = image[y * (SetupHelp::Width / 2) + x / 2];
        return x % 2 == 0 ? byte >> 4 : byte & 0x0F;
    }

    const uint8_t White = 0x1;
    const uint8_t Black = 0x0;

    // Whether every pixel in the columns from left to right (not included) is white.
    bool columnsWhite(const uint8_t* image, int left, int right)
    {
        for (int y = 0; y < SetupHelp::Height; y++)
        {
            for (int x = left; x < right; x++)
            {
                if (pixel(image, x, y) != White)
                {
                    return false;
                }
            }
        }
        return true;
    }

    // The lowest row with a black pixel, or -1.
    int lowestInk(const uint8_t* image)
    {
        for (int y = SetupHelp::Height - 1; y >= 0; y--)
        {
            for (int x = 0; x < SetupHelp::Width; x++)
            {
                if (pixel(image, x, y) == Black)
                {
                    return y;
                }
            }
        }
        return -1;
    }

    // Only white and black: the help uses no other colours.
    bool onlyBlackAndWhite(const uint8_t* image)
    {
        for (int y = 0; y < SetupHelp::Height; y++)
        {
            for (int x = 0; x < SetupHelp::Width; x++)
            {
                uint8_t colour = pixel(image, x, y);
                if (colour != White && colour != Black)
                {
                    return false;
                }
            }
        }
        return true;
    }

    std::vector<uint8_t> drawn(Screen screen, const SetupHelp::Details& details, int qrSize, bool hide)
    {
        std::vector<uint8_t> image(SetupHelp::Size, 0xAA);
        FakeQr qr(qrSize);
        SetupHelp::draw(image.data(), screen, details, qr.code(), hide);
        return image;
    }

    void savePreview(const char* name, const std::vector<uint8_t>& image)
    {
        const char* folder = getenv("SETUP_HELP_PREVIEW");
        if (!folder)
        {
            return;
        }

        std::string path = std::string(folder) + "/" + name + ".ppm";
        FILE* file = fopen(path.c_str(), "wb");
        TEST_ASSERT_NOT_NULL(file);
        fprintf(file, "P6\n%d %d\n255\n", SetupHelp::Width, SetupHelp::Height);
        for (int y = 0; y < SetupHelp::Height; y++)
        {
            for (int x = 0; x < SetupHelp::Width; x++)
            {
                unsigned char value = pixel(image.data(), x, y) == White ? 255 : 0;
                unsigned char rgb[3] = {value, value, value};
                fwrite(rgb, 1, 3, file);
            }
        }
        fclose(file);
    }
}

void testScreenFollowsTheWifi()
{
    TEST_ASSERT_EQUAL(Screen::JoinWifi, SetupHelp::screenFor(false, true));
    TEST_ASSERT_EQUAL(Screen::Ready, SetupHelp::screenFor(true, false));
    // On the home Wi-Fi with its own network still open, the moment before it closes
    TEST_ASSERT_EQUAL(Screen::Ready, SetupHelp::screenFor(true, true));
    // Still joining a saved network: no help yet, so it doesn't redraw twice
    TEST_ASSERT_EQUAL(Screen::None, SetupHelp::screenFor(false, false));
}

void testWifiQrJoinsTheTapsNetwork()
{
    TEST_ASSERT_EQUAL_STRING(
        "WIFI:T:WPA;S:DavBar Tap 2;P:nine-char;;",
        SetupHelp::qrText(Screen::JoinWifi, tap2()).c_str()
    );

    // Backslashes, semicolons, commas, colons and quotes are escaped.
    SetupHelp::Details odd = tap2("a\\b;c,d:e\"f");
    odd.network = "Bar;Tap";
    TEST_ASSERT_EQUAL_STRING(
        "WIFI:T:WPA;S:Bar\\;Tap;P:a\\\\b\\;c\\,d\\:e\\\"f;;",
        SetupHelp::qrText(Screen::JoinWifi, odd).c_str()
    );
}

void testReadyQrOpensThePageByIp()
{
    TEST_ASSERT_EQUAL_STRING(
        "http://192.168.0.112/",
        SetupHelp::qrText(Screen::Ready, tap2()).c_str()
    );
    TEST_ASSERT_EQUAL_STRING("", SetupHelp::qrText(Screen::None, tap2()).c_str());
}

void testNoneIsBlank()
{
    std::vector<uint8_t> image = drawn(Screen::None, tap2(), 33, false);
    TEST_ASSERT_TRUE(columnsWhite(image.data(), 0, SetupHelp::Width));
}

void testBothScreensFitInsideTheMargins()
{
    // Version 2 to 4 codes: an address, and a Wi-Fi network with a password
    for (int qrSize : {25, 29, 33})
    {
        for (Screen screen : {Screen::JoinWifi, Screen::Ready})
        {
            std::vector<uint8_t> image = drawn(screen, tap2(), qrSize, false);
            TEST_ASSERT_TRUE(onlyBlackAndWhite(image.data()));
            TEST_ASSERT_TRUE(columnsWhite(image.data(), 0, 14));
            TEST_ASSERT_TRUE(columnsWhite(image.data(), SetupHelp::Width - 14, SetupHelp::Width));

            // The last line is drawn, and clear of the strip below.
            int lowest = lowestInk(image.data());
            TEST_ASSERT_GREATER_THAN(340, lowest);
            TEST_ASSERT_LESS_THAN(SetupHelp::Height - 4, lowest);
        }
    }

    savePreview("setup-help-join", drawn(Screen::JoinWifi, tap2(), 33, false));
    savePreview("setup-help-ready", drawn(Screen::Ready, tap2(), 25, false));
    savePreview("setup-help-join-preview", drawn(Screen::JoinWifi, tap2(), 33, true));
}

void testQrIsCentredInWholePixels()
{
    // 33 modules at 5 pixels each: 165 wide, from x 117, from y 106.
    std::vector<uint8_t> image = drawn(Screen::JoinWifi, tap2(), 33, false);
    // The top left finder's outer ring and the white inside it
    TEST_ASSERT_EQUAL(Black, pixel(image.data(), 117, 106));
    TEST_ASSERT_EQUAL(Black, pixel(image.data(), 117 + 34, 106 + 34));
    TEST_ASSERT_EQUAL(White, pixel(image.data(), 117 + 7, 106 + 7));
    TEST_ASSERT_EQUAL(White, pixel(image.data(), 116, 120));
    // The top right finder ends at the code's right edge.
    TEST_ASSERT_EQUAL(Black, pixel(image.data(), 117 + 164, 106));
    TEST_ASSERT_EQUAL(White, pixel(image.data(), 117 + 165, 106));
}

void testLongPasswordWrapsOntoItsOwnLine()
{
    // Too long to share a line with "Password:", short enough for one of its own
    std::vector<uint8_t> image =
        drawn(Screen::JoinWifi, tap2("a-much-longer-setup-pass"), 33, false);
    TEST_ASSERT_TRUE(columnsWhite(image.data(), 0, 14));
    TEST_ASSERT_TRUE(columnsWhite(image.data(), SetupHelp::Width - 14, SetupHelp::Width));
    // Four lines don't fit under the code, so the last is left out rather than
    // cut off at the bottom.
    TEST_ASSERT_LESS_THAN(SetupHelp::Height - 4, lowestInk(image.data()));
}

void testPreviewHidesThePassword()
{
    std::vector<uint8_t> shown = drawn(Screen::JoinWifi, tap2(), 33, false);
    std::vector<uint8_t> hidden = drawn(Screen::JoinWifi, tap2(), 33, true);
    std::vector<uint8_t> otherPassword = drawn(Screen::JoinWifi, tap2("other-one"), 33, true);

    TEST_ASSERT_TRUE(memcmp(shown.data(), hidden.data(), shown.size()) != 0);
    // Hidden, any password draws the same.
    TEST_ASSERT_EQUAL_MEMORY(hidden.data(), otherPassword.data(), hidden.size());
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(testScreenFollowsTheWifi);
    RUN_TEST(testWifiQrJoinsTheTapsNetwork);
    RUN_TEST(testReadyQrOpensThePageByIp);
    RUN_TEST(testNoneIsBlank);
    RUN_TEST(testBothScreensFitInsideTheMargins);
    RUN_TEST(testQrIsCentredInWholePixels);
    RUN_TEST(testLongPasswordWrapsOntoItsOwnLine);
    RUN_TEST(testPreviewHidesThePassword);
    return UNITY_END();
}
