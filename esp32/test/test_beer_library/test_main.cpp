// Runs on the laptop: pio test -d esp32 -e native
// The beer library's rules: IDs, file names, JPEGs, and which pages may read and
// remove beers.

#include <BeerLibrary.h>
#include <unity.h>

using BeerLibrary::FileKind;

void setUp() {}

void tearDown() {}

static void test_ids_are_the_crc_in_8_lowercase_hex_digits()
{
    TEST_ASSERT_EQUAL_STRING("1a2b3c4d", BeerLibrary::idFor(0x1A2B3C4D).c_str());
    TEST_ASSERT_EQUAL_STRING("0000002a", BeerLibrary::idFor(42).c_str());
    TEST_ASSERT_EQUAL_STRING("ffffffff", BeerLibrary::idFor(0xFFFFFFFF).c_str());

    TEST_ASSERT_TRUE(BeerLibrary::isId("1a2b3c4d"));
    TEST_ASSERT_FALSE(BeerLibrary::isId("1A2B3C4D"));
    TEST_ASSERT_FALSE(BeerLibrary::isId("1a2b3c4"));
    TEST_ASSERT_FALSE(BeerLibrary::isId("1a2b3c4d5"));
    TEST_ASSERT_FALSE(BeerLibrary::isId("../image"));
    TEST_ASSERT_FALSE(BeerLibrary::isId(""));
}

static void test_a_list_of_ids_keeps_each_valid_one_once_in_order()
{
    auto ids = BeerLibrary::parseIds("5e6f7a8b,1a2b3c4d,,nope,5e6f7a8b,../image.bin,0000002a,");

    TEST_ASSERT_EQUAL(3, ids.size());
    TEST_ASSERT_EQUAL_STRING("5e6f7a8b", ids[0].c_str());
    TEST_ASSERT_EQUAL_STRING("1a2b3c4d", ids[1].c_str());
    TEST_ASSERT_EQUAL_STRING("0000002a", ids[2].c_str());

    TEST_ASSERT_EQUAL(0, BeerLibrary::parseIds("").size());
}

static void test_only_a_beers_own_file_names_are_served()
{
    std::string id;

    TEST_ASSERT_TRUE(BeerLibrary::fileKind("1a2b3c4d.jpg", id) == FileKind::Image);
    TEST_ASSERT_EQUAL_STRING("1a2b3c4d", id.c_str());
    TEST_ASSERT_TRUE(BeerLibrary::fileKind("1a2b3c4d.thumb.jpg", id) == FileKind::Thumbnail);
    TEST_ASSERT_EQUAL_STRING("1a2b3c4d", id.c_str());

    TEST_ASSERT_TRUE(BeerLibrary::fileKind("1a2b3c4d.shown", id) == FileKind::None);
    TEST_ASSERT_TRUE(BeerLibrary::fileKind("upload.jpg", id) == FileKind::None);
    TEST_ASSERT_TRUE(BeerLibrary::fileKind("upload.thumb.jpg", id) == FileKind::None);
    TEST_ASSERT_TRUE(BeerLibrary::fileKind("1A2B3C4D.jpg", id) == FileKind::None);
    TEST_ASSERT_TRUE(BeerLibrary::fileKind("../image.bin", id) == FileKind::None);
    TEST_ASSERT_TRUE(BeerLibrary::fileKind("", id) == FileKind::None);
}

static void test_jpegs_are_recognised_by_their_first_bytes()
{
    const uint8_t jpeg[] = {0xFF, 0xD8, 0xFF, 0xE0};
    const uint8_t png[] = {0x89, 'P', 'N', 'G'};

    TEST_ASSERT_TRUE(BeerLibrary::isJpegStart(jpeg, sizeof(jpeg)));
    TEST_ASSERT_FALSE(BeerLibrary::isJpegStart(png, sizeof(png)));
    TEST_ASSERT_FALSE(BeerLibrary::isJpegStart(jpeg, 2));
}

static void test_other_taps_and_local_pages_may_use_the_library()
{
    TEST_ASSERT_TRUE(BeerLibrary::isLocalOrigin("http://davbar-tap2.local"));
    TEST_ASSERT_TRUE(BeerLibrary::isLocalOrigin("http://davbar-tap2.local:80"));
    TEST_ASSERT_TRUE(BeerLibrary::isLocalOrigin("http://192.168.0.109"));
    TEST_ASSERT_TRUE(BeerLibrary::isLocalOrigin("http://10.183.167.251"));
    TEST_ASSERT_TRUE(BeerLibrary::isLocalOrigin("http://172.16.0.5"));
    TEST_ASSERT_TRUE(BeerLibrary::isLocalOrigin("http://172.31.255.1"));
    TEST_ASSERT_TRUE(BeerLibrary::isLocalOrigin("http://127.0.0.1:5199"));
    TEST_ASSERT_TRUE(BeerLibrary::isLocalOrigin("http://localhost:5199"));
}

static void test_websites_may_not_use_the_library()
{
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("https://example.com"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("http://example.com"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("http://172.32.0.1"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("http://8.8.8.8"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("http://192.168.0.109.example.com"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("http://davbar.local.example.com"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("http://.local"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("http://192.168.0.300"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("http://192.168.0.109:"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("http://192.168.0.109/path"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("https://192.168.0.109"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin("null"));
    TEST_ASSERT_FALSE(BeerLibrary::isLocalOrigin(""));
}

static void test_the_index_lists_each_beer_and_when_it_was_shown()
{
    std::vector<BeerLibrary::Shown> beers = {
        { "1a2b3c4d", 1762768232 },
        { "0000002a", 0 },
    };

    TEST_ASSERT_EQUAL_STRING("1a2b3c4d 1762768232\n0000002a 0\n", BeerLibrary::formatIndex(beers).c_str());

    auto read = BeerLibrary::parseIndex(BeerLibrary::formatIndex(beers));
    TEST_ASSERT_EQUAL(2, read.size());
    TEST_ASSERT_EQUAL_STRING("1a2b3c4d", read[0].id.c_str());
    TEST_ASSERT_EQUAL_INT64(1762768232, read[0].seconds);
    TEST_ASSERT_EQUAL_STRING("0000002a", read[1].id.c_str());
    TEST_ASSERT_EQUAL_INT64(0, read[1].seconds);
}

static void test_a_damaged_index_keeps_the_lines_it_can_read()
{
    // Cut short by a power cut, a repeat and some junk
    auto read = BeerLibrary::parseIndex(
        "1a2b3c4d 1762768232\njunk\n5e6f7a8b x\n1a2b3c4d 5\nABCDEF12 7\n0000002a 17627"
    );

    TEST_ASSERT_EQUAL(2, read.size());
    TEST_ASSERT_EQUAL_STRING("1a2b3c4d", read[0].id.c_str());
    TEST_ASSERT_EQUAL_INT64(1762768232, read[0].seconds);
    TEST_ASSERT_EQUAL_STRING("0000002a", read[1].id.c_str());
    TEST_ASSERT_EQUAL_INT64(17627, read[1].seconds);

    TEST_ASSERT_EQUAL(0, BeerLibrary::parseIndex("").size());
}

static void test_beers_are_listed_last_shown_first()
{
    std::vector<BeerLibrary::Shown> beers = {
        { "bbbbbbbb", 0 },
        { "11111111", 100 },
        { "aaaaaaaa", 0 },
        { "22222222", 300 },
    };

    BeerLibrary::sortByShown(beers);

    TEST_ASSERT_EQUAL_STRING("22222222", beers[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING("11111111", beers[1].id.c_str());
    TEST_ASSERT_EQUAL_STRING("aaaaaaaa", beers[2].id.c_str());
    TEST_ASSERT_EQUAL_STRING("bbbbbbbb", beers[3].id.c_str());
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_ids_are_the_crc_in_8_lowercase_hex_digits);
    RUN_TEST(test_a_list_of_ids_keeps_each_valid_one_once_in_order);
    RUN_TEST(test_only_a_beers_own_file_names_are_served);
    RUN_TEST(test_jpegs_are_recognised_by_their_first_bytes);
    RUN_TEST(test_other_taps_and_local_pages_may_use_the_library);
    RUN_TEST(test_websites_may_not_use_the_library);
    RUN_TEST(test_the_index_lists_each_beer_and_when_it_was_shown);
    RUN_TEST(test_a_damaged_index_keeps_the_lines_it_can_read);
    RUN_TEST(test_beers_are_listed_last_shown_first);
    return UNITY_END();
}
