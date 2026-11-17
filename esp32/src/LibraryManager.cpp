#include "LibraryManager.h"

#include <BeerLibrary.h>
#include <algorithm>
#include <dirent.h>
#include <esp_crc.h>
#include <new>
#include <string.h>
#include <time.h>
#include <vector>

#include "DeviceLog.h"
#include "Storage.h"

using BeerLibrary::FileKind;
using BeerLibrary::Shown;

static const char* folder = "/library";
// The same folder for the C library's functions: DataFS is mounted at /data.
static const char* mountedFolder = "/data/library";
static const char* imageUploadPath = "/library/upload.jpg";
static const char* thumbnailUploadPath = "/library/upload.thumb.jpg";
static const char* indexPath = "/library/index.txt";
static const char* newIndexPath = "/library/index.new";

// Left free beyond an upload, for LittleFS's own use and the log.
static const size_t spareBytes = 64 * 1024;

// Before this (2021), the clock hasn't been set from the internet.
static const time_t clockSetAfter = 1609459200;

// Every beer on this tap, last shown first. Kept in memory so listing never
// opens a file, as LittleFS is slow with many files in a folder; index.txt
// keeps the times over a restart. After startLibrary(), only the web server's
// task uses it.
static std::vector<Shown> beers;

static String pathFor(const std::string& name)
{
    return String(folder) + "/" + name.c_str();
}

static String imagePath(const std::string& id)
{
    return pathFor(id + ".jpg");
}

static String thumbnailPath(const std::string& id)
{
    return pathFor(id + ".thumb.jpg");
}

static std::vector<Shown>::iterator findBeer(const std::string& id)
{
    return std::find_if(
        beers.begin(),
        beers.end(),
        [&id](const Shown& beer) { return beer.id == id; }
    );
}

// Writes the index whole, then swaps it in, so a power cut leaves the old one.
static void saveIndex()
{
    std::string text = BeerLibrary::formatIndex(beers);
    File file = DataFS.open(newIndexPath, "w");
    if (!file)
    {
        return;
    }

    bool written = file.write(reinterpret_cast<const uint8_t*>(text.data()), text.size()) == text.size();
    file.close();

    if (!written || !DataFS.rename(newIndexPath, indexPath))
    {
        removeDataFile(newIndexPath);
        logEvent("beer library", "unable to save its index");
    }
}

static void markShown(const std::string& id)
{
    time_t now = time(nullptr);
    int64_t seconds = now >= clockSetAfter ? static_cast<int64_t>(now) : 0;

    auto beer = findBeer(id);
    if (beer != beers.end())
    {
        beer->seconds = seconds;
    }
    else
    {
        beers.push_back({ id, seconds });
    }

    BeerLibrary::sortByShown(beers);
    saveIndex();
}

// The names of the files in the library's folder, without opening them.
static std::vector<std::string> fileNames()
{
    std::vector<std::string> names;
    DIR* directory = opendir(mountedFolder);

    if (directory)
    {
        for (struct dirent* entry = readdir(directory); entry; entry = readdir(directory))
        {
            names.push_back(entry->d_name);
        }
        closedir(directory);
    }

    return names;
}

static void sendJson(AsyncWebServerRequest* request, int code, const JsonDocument& doc)
{
    String payload;
    serializeJson(doc, payload);

    AsyncWebServerResponse* response = request->beginResponse(code, "application/json", payload);
    response->addHeader("Cache-Control", "no-store");
    request->send(response);
}

void allowLocalPages(AsyncWebServerRequest* request, ArMiddlewareNext next)
{
    next();

    AsyncWebServerResponse* response = request->getResponse();
    if (!response)
    {
        return;
    }

    // The answer depends on the asking page, so a browser mustn't reuse one
    // page's copy for another.
    response->addHeader("Vary", "Origin");

    if (request->hasHeader("Origin"))
    {
        const String& origin = request->header("Origin");
        if (BeerLibrary::isLocalOrigin(origin.c_str()))
        {
            response->addHeader("Access-Control-Allow-Origin", origin);
        }
    }
}

static void handleList(AsyncWebServerRequest* request)
{
    JsonDocument doc;
    doc["capacity"] = BeerLibrary::Capacity;
    JsonArray list = doc["beers"].to<JsonArray>();

    for (const Shown& beer : beers)
    {
        JsonObject item = list.add<JsonObject>();
        item["id"] = beer.id;

        if (beer.seconds)
        {
            time_t shownAt = static_cast<time_t>(beer.seconds);
            struct tm utc;
            char text[21];
            gmtime_r(&shownAt, &utc);
            strftime(text, sizeof(text), "%Y-%m-%dT%H:%M:%SZ", &utc);
            item["shownAt"] = text;
        }
        else
        {
            item["shownAt"] = nullptr;
        }
    }

    sendJson(request, 200, doc);
}

static void handleFile(AsyncWebServerRequest* request)
{
    std::string name = request->url().substring(strlen("/library/")).c_str();
    std::string id;
    String path = pathFor(name);

    // Unknown beers are turned away without looking in storage, which is slow
    // with many files in a folder. A known beer's file is opened straight away,
    // and the response answers 404 itself if it has gone.
    if (BeerLibrary::fileKind(name, id) == FileKind::None || findBeer(id) == beers.end())
    {
        request->send(404, "text/plain", "Not found");
        return;
    }

    AsyncWebServerResponse* response = request->beginResponse(DataFS, path, "image/jpeg");
    // A beer's ID is its picture's checksum, so its files never change.
    response->addHeader("Cache-Control", "max-age=31536000, immutable");
    request->send(response);
}

static void handleRemove(AsyncWebServerRequest* request)
{
    std::vector<std::string> ids = BeerLibrary::parseIds(request->arg("ids").c_str());
    JsonDocument doc;

    if (ids.empty() || ids.size() > BeerLibrary::MaxRemovedAtOnce)
    {
        doc["success"] = false;
        doc["message"] = ids.empty()
            ? "Choose the beers to remove."
            : "Remove at most 10 beers at a time.";
        sendJson(request, 400, doc);
        return;
    }

    size_t removed = 0;
    bool failed = false;
    String removedIds;

    for (const std::string& id : ids)
    {
        auto beer = findBeer(id);
        if (beer == beers.end())
        {
            continue;
        }

        // The picture first: without it, a beer is gone even if its thumbnail
        // stays behind.
        if (!removeDataFile(imagePath(id)))
        {
            failed = true;
            continue;
        }

        removeDataFile(thumbnailPath(id));
        beers.erase(beer);
        removed++;
        removedIds += (removedIds.isEmpty() ? "" : ", ") + String(id.c_str());
    }

    if (removed > 0)
    {
        saveIndex();
        logEventNow("beers removed", removedIds);
    }

    doc["success"] = !failed;
    doc["removed"] = removed;
    doc["count"] = beers.size();
    doc["capacity"] = BeerLibrary::Capacity;
    if (failed)
    {
        doc["message"] = "Some beers couldn't be removed. Try again.";
    }
    sendJson(request, failed ? 500 : 200, doc);
}

enum class Part : uint8_t
{
    None,
    Image,
    Thumbnail,
};

struct LibraryUpload
{
    // False for an upload turned away while another was in progress: it mustn't
    // touch the other one's files.
    bool owner = false;
    File file;
    Part part = Part::None;
    size_t partBytes = 0;
    size_t imageBytes = 0;
    size_t thumbnailBytes = 0;
    uint32_t crc = 0;
    int errorCode = 0;
    const char* error = nullptr;
};

static bool uploading = false;

static void failUpload(LibraryUpload* upload, int code, const char* message)
{
    if (!upload->error)
    {
        upload->errorCode = code;
        upload->error = message;
    }

    if (upload->file)
    {
        upload->file.close();
    }
}

// Removes the upload's working files, unless they became a beer, and lets the
// next upload start.
static void endUpload(LibraryUpload* upload)
{
    if (upload->file)
    {
        upload->file.close();
    }

    if (upload->owner)
    {
        removeDataFile(imageUploadPath);
        removeDataFile(thumbnailUploadPath);
        uploading = false;
    }

    delete upload;
}

static void handleUpload(
    AsyncWebServerRequest* request,
    const String& filename,
    size_t index,
    uint8_t* data,
    size_t len,
    bool final
)
{
    LibraryUpload* upload = static_cast<LibraryUpload*>(request->_tempObject);

    if (!upload)
    {
        upload = new (std::nothrow) LibraryUpload();
        if (!upload)
        {
            return;
        }

        request->_tempObject = upload;
        request->onDisconnect(
            [request]()
            {
                LibraryUpload* unfinished = static_cast<LibraryUpload*>(request->_tempObject);
                request->_tempObject = nullptr;
                if (unfinished)
                {
                    endUpload(unfinished);
                    logEvent("beer upload failed", "the connection closed before it finished");
                }
            }
        );

        if (uploading)
        {
            failUpload(upload, 503, "Another beer is being saved. Try again in a moment.");
            return;
        }

        upload->owner = true;
        uploading = true;

        size_t freeBytes = DataFS.totalBytes() - DataFS.usedBytes();
        if (request->contentLength() + spareBytes > freeBytes)
        {
            failUpload(upload, 507, "There isn't enough room on this tap to save the beer.");
            return;
        }
    }

    if (upload->error)
    {
        return;
    }

    if (index == 0)
    {
        upload->part =
            filename == "image.jpg" ? Part::Image :
            filename == "thumbnail.jpg" ? Part::Thumbnail :
            Part::None;

        bool repeated =
            (upload->part == Part::Image && upload->imageBytes > 0) ||
            (upload->part == Part::Thumbnail && upload->thumbnailBytes > 0);

        if (upload->part == Part::None || repeated)
        {
            failUpload(upload, 400, "Send one image.jpg and one thumbnail.jpg.");
            return;
        }

        if (!BeerLibrary::isJpegStart(data, len))
        {
            failUpload(upload, 400, "The beer's pictures must be JPEGs.");
            return;
        }

        const char* path = upload->part == Part::Image ? imageUploadPath : thumbnailUploadPath;
        removeDataFile(path);
        upload->file = DataFS.open(path, "w");
        upload->partBytes = 0;
        upload->crc = upload->part == Part::Image ? 0 : upload->crc;

        if (!upload->file)
        {
            failUpload(upload, 500, "Unable to save the beer.");
            return;
        }
    }

    bool image = upload->part == Part::Image;
    if (upload->partBytes + len > (image ? BeerLibrary::MaxImageBytes : BeerLibrary::MaxThumbnailBytes))
    {
        failUpload(
            upload,
            413,
            image ? "The picture must be at most 70 KB." : "The thumbnail must be at most 16 KB."
        );
        return;
    }

    if (upload->file.write(data, len) != len)
    {
        failUpload(upload, 500, "Unable to save the beer.");
        return;
    }

    if (image)
    {
        upload->crc = esp_crc32_le(upload->crc, data, len);
    }
    upload->partBytes += len;

    if (final)
    {
        upload->file.close();
        (image ? upload->imageBytes : upload->thumbnailBytes) = upload->partBytes;
    }
}

static void handleUploadFinished(AsyncWebServerRequest* request)
{
    LibraryUpload* upload = static_cast<LibraryUpload*>(request->_tempObject);
    request->_tempObject = nullptr;

    JsonDocument doc;
    doc["capacity"] = BeerLibrary::Capacity;

    if (upload && !upload->error && (upload->imageBytes == 0 || upload->thumbnailBytes == 0))
    {
        failUpload(upload, 400, "Send one image.jpg and one thumbnail.jpg.");
    }

    if (!upload || upload->error)
    {
        doc["success"] = false;
        doc["message"] = upload ? upload->error : "Send one image.jpg and one thumbnail.jpg.";
        int code = upload ? upload->errorCode : 400;

        if (upload)
        {
            logEvent("beer upload failed", upload->error);
            endUpload(upload);
        }

        sendJson(request, code, doc);
        return;
    }

    std::string id = BeerLibrary::idFor(upload->crc);
    doc["id"] = id;

    // Already here: shown again.
    if (findBeer(id) != beers.end())
    {
        endUpload(upload);
        markShown(id);
        logEvent("beer shown again", id.c_str());

        doc["success"] = true;
        doc["saved"] = false;
        doc["count"] = beers.size();
        sendJson(request, 200, doc);
        return;
    }

    size_t count = beers.size();
    if (count >= BeerLibrary::Capacity)
    {
        endUpload(upload);
        logEvent("beer not saved", "the library is full");

        doc["success"] = false;
        doc["full"] = true;
        doc["count"] = count;
        doc["message"] = "This tap's library is full. Remove a beer first.";
        sendJson(request, 409, doc);
        return;
    }

    bool saved =
        DataFS.rename(thumbnailUploadPath, thumbnailPath(id)) &&
        DataFS.rename(imageUploadPath, imagePath(id));
    size_t imageBytes = upload->imageBytes;
    endUpload(upload);

    if (!saved)
    {
        removeDataFile(thumbnailPath(id));
        logEvent("beer upload failed", "unable to save the files");

        doc["success"] = false;
        doc["message"] = "Unable to save the beer.";
        sendJson(request, 500, doc);
        return;
    }

    markShown(id);
    logEventNow("beer saved", String(id.c_str()) + ", " + String(imageBytes) + " bytes");

    doc["success"] = true;
    doc["saved"] = true;
    doc["count"] = count + 1;
    sendJson(request, 200, doc);
}

void startLibrary()
{
    if (!DataFS.exists(folder))
    {
        DataFS.mkdir(folder);
    }

    removeDataFile(imageUploadPath);
    removeDataFile(thumbnailUploadPath);
    removeDataFile(newIndexPath);

    // The beers are the pictures in the folder; the index says when each was
    // last shown.
    std::string indexText;
    File index = DataFS.exists(indexPath) ? DataFS.open(indexPath, "r") : File();
    if (index)
    {
        indexText = index.readString().c_str();
        index.close();
    }
    std::vector<Shown> indexed = BeerLibrary::parseIndex(indexText);

    std::vector<std::string> names = fileNames();
    std::vector<std::string> thumbnails;

    beers.clear();
    for (const std::string& name : names)
    {
        std::string id;
        FileKind kind = BeerLibrary::fileKind(name, id);

        if (kind == FileKind::Thumbnail)
        {
            thumbnails.push_back(id);
        }
        else if (kind == FileKind::Image)
        {
            auto known = std::find_if(
                indexed.begin(),
                indexed.end(),
                [&id](const Shown& beer) { return beer.id == id; }
            );
            beers.push_back({ id, known != indexed.end() ? known->seconds : 0 });
        }
    }
    BeerLibrary::sortByShown(beers);

    // Removes anything else, such as a thumbnail whose picture was removed
    // when the power went, or files from an older version.
    for (const std::string& name : names)
    {
        std::string id;
        FileKind kind = BeerLibrary::fileKind(name, id);
        bool keep =
            name == "index.txt" ||
            kind == FileKind::Image ||
            (kind == FileKind::Thumbnail && findBeer(id) != beers.end());

        if (!keep)
        {
            removeDataFile(pathFor(name));
        }
    }

    // Brings the index into line, as after a power cut part-way through a save.
    if (BeerLibrary::formatIndex(beers) != indexText)
    {
        saveIndex();
    }
}

void addLibraryRoutes(AsyncWebServer& server)
{
    server.on(AsyncURIMatcher::exact("/library"), HTTP_GET, handleList)
        .addMiddleware(allowLocalPages);

    server.on(AsyncURIMatcher::exact("/library"), HTTP_POST, handleUploadFinished, handleUpload)
        .addMiddleware(allowLocalPages);

    server.on(AsyncURIMatcher::exact("/library/remove"), HTTP_POST, handleRemove)
        .addMiddleware(allowLocalPages);

    server.on(AsyncURIMatcher::prefix("/library/"), HTTP_GET, handleFile)
        .addMiddleware(allowLocalPages);
}

void addLibraryStatus(JsonObject library)
{
    library["count"] = beers.size();
    library["capacity"] = BeerLibrary::Capacity;
}

bool clearLibrary()
{
    bool cleared = true;
    for (const std::string& name : fileNames())
    {
        cleared = removeDataFile(pathFor(name)) && cleared;
    }

    beers.clear();

    return cleared;
}
