#pragma once

// The beer library's rules, apart from the files, so they can be tested on the
// laptop: pio test -d esp32 -e native. src/LibraryManager.cpp keeps the files.
//
// Each beer is the web app's 400 x 400 picture as a JPEG, with a small thumbnail.
// Its ID is the JPEG's CRC-32 as 8 lowercase hex digits, so the same picture has
// the same ID on every tap and the web app can show each beer once.

#include <stddef.h>
#include <stdint.h>
#include <string>
#include <vector>

namespace BeerLibrary
{
    // Beers per tap. When full, the web app asks which to remove; nothing is ever
    // removed automatically.
    constexpr size_t Capacity = 30;
    constexpr size_t MaxImageBytes = 70 * 1024;
    constexpr size_t MaxThumbnailBytes = 16 * 1024;
    // Beers removed in one request. Removing one takes about 0.15s, and the web
    // server's task restarts the tap if a request holds it for 5s, so the web
    // app sends more in batches.
    constexpr size_t MaxRemovedAtOnce = 10;

    // "1a2b3c4d" for a CRC-32 of 0x1A2B3C4D.
    std::string idFor(uint32_t crc);

    // Exactly 8 lowercase hex digits.
    bool isId(const std::string& text);

    // The IDs in a comma-separated list, such as "1a2b3c4d,5e6f7a8b", each once
    // and in order. Anything that isn't an ID is left out.
    std::vector<std::string> parseIds(const std::string& list);

    enum class FileKind
    {
        None,
        Image,
        Thumbnail,
    };

    // A beer's file name, "<id>.jpg" or "<id>.thumb.jpg", and its ID. None for
    // any other name, such as a half-uploaded file's.
    FileKind fileKind(const std::string& name, std::string& id);

    // Every JPEG starts with these bytes.
    bool isJpegStart(const uint8_t* data, size_t length);

    // A beer and when it was last shown on this tap, in seconds since 1970, or 0
    // if the clock wasn't set then.
    struct Shown
    {
        std::string id;
        int64_t seconds;
    };

    // Last shown first; those shown before the clock was set last, by ID.
    void sortByShown(std::vector<Shown>& beers);

    // The index file, one "<id> <seconds>" line per beer, so the tap can list
    // its beers without opening every file: LittleFS is slow with many files in
    // a folder. parseIndex skips any line it can't read.
    std::string formatIndex(const std::vector<Shown>& beers);
    std::vector<Shown> parseIndex(const std::string& text);

    // Whether a page at this origin, such as "http://davbar-tap2.local", may read
    // and remove beers: another tap's page, or the web app's dev server. True for
    // http pages at .local names, localhost and private network addresses (10.x,
    // 172.16-31.x, 192.168.x and 127.x).
    bool isLocalOrigin(const std::string& origin);
}
