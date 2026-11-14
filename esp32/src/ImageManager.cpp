#include "ImageManager.h"

#include <ScreenLayout.h>
#include <Strip.h>
#include <esp_crc.h>
#include <new>

#include "DEV_Config.h"
#include "DeviceLog.h"
#include "EPD_4in0e.h"
#include "ImageLoader.h"
#include "Screen.h"
#include "SetupHelpManager.h"
#include "Storage.h"
#include "StripManager.h"

static bool imageUpdatePending = false;
static bool forcedImageUpdatePending = false;
static const char* imageUpdateReason = "";

// The whole screen: the saved image on top, the strip below.
static uint8_t screenBuffer[SCREEN_SIZE];

static_assert(Strip::Size == SCREEN_SIZE - IMAGE_SIZE, "The strip fills the rows below the image");

static const char* displayedImageCrcPath = "/image.displayed.crc";
static const char* pendingDisplayedImageCrcPath = "/image.displayed.crc.tmp";

static bool displayedImageCrcMatches(uint32_t imageCrc);
static bool saveDisplayedImageCrc(uint32_t imageCrc);
static void updateDisplay(bool force, const char* reason);
static void drawScreen(bool force, const char* reason, const Strip::Values& strip);

struct ImageUploadState
{
    File file;
    size_t bytesWritten;
    // The square's 80000 bytes, or the whole screen's 120000.
    size_t total;
    ImageUploadError error;
};

const char* imageUploadErrorMessage(ImageUploadError error)
{
    switch (error)
    {
        case ImageUploadError::InvalidContentType:
            return "Image must be uploaded as application/octet-stream.";
        case ImageUploadError::InvalidSize:
            return "The image must be 80000 bytes, the square, or 120000, the whole screen.";
        case ImageUploadError::OpenFailed:
            return "Unable to create the image file.";
        case ImageUploadError::OutOfOrder:
            return "Image data arrived out of order.";
        case ImageUploadError::WriteFailed:
            return "Unable to write the complete image file.";
        case ImageUploadError::ReplaceFailed:
            return "Unable to replace the existing image.";
        case ImageUploadError::SaveFailed:
            return "Unable to save the uploaded image.";
        default:
            return "Unable to process the image upload.";
    }
}

ImageUploadState* beginImageUpload(
    const String& contentType,
    size_t total
)
{
    ImageUploadState* state = new (std::nothrow) ImageUploadState {
        File(),
        0,
        total,
        ImageUploadError::None
    };

    if (!state)
    {
        Serial.println("Failed to allocate image upload state");
        return nullptr;
    }

    if (contentType != "application/octet-stream")
    {
        state->error = ImageUploadError::InvalidContentType;
        return state;
    }

    if (!ScreenLayout::pictureSize(total))
    {
        state->error = ImageUploadError::InvalidSize;
        return state;
    }

    removeDataFile("/image.upload");
    state->file = DataFS.open("/image.upload", "w");

    if (!state->file)
    {
        Serial.println("Failed to open image.upload");
        state->error = ImageUploadError::OpenFailed;
    }

    return state;
}

void writeImageUploadChunk(
    ImageUploadState* state,
    const uint8_t* data,
    size_t len,
    size_t index
)
{
    if (!state || state->error != ImageUploadError::None)
    {
        return;
    }

    if (index != state->bytesWritten)
    {
        state->error = ImageUploadError::OutOfOrder;
        return;
    }

    size_t written = state->file.write(data, len);
    state->bytesWritten += written;

    if (written != len)
    {
        state->error = ImageUploadError::WriteFailed;
    }
}

// How the web app drew the saved picture, if it did (finishImageUpload).
static const char* sourcePath = "/image.source";

// After the picture is saved. A failure leaves no source, so the web app works
// from the picture's pixels instead.
static void saveImageSource(const String& source)
{
    File file = DataFS.open(sourcePath, "w");
    bool written = file && file.print(source) == source.length();
    if (file)
    {
        file.close();
    }

    if (!written)
    {
        removeDataFile(sourcePath);
        logEvent("storage error", "unable to save how the picture was drawn");
    }
}

String imageSource()
{
    // Checked first, because opening a missing file logs an error.
    if (!DataFS.exists(sourcePath))
    {
        return String();
    }

    File file = DataFS.open(sourcePath, "r");
    if (!file)
    {
        return String();
    }

    String source = file.size() <= MaxImageSourceLength ? file.readString() : String();
    file.close();

    return source;
}

ImageUploadResult finishImageUpload(ImageUploadState* state, bool redraw, const String& source)
{
    if (state && state->file)
    {
        state->file.close();
    }

    ImageUploadError error = state
        ? state->error
        : ImageUploadError::OpenFailed;

    bool wholeScreen = state && state->total == SCREEN_SIZE;

    if (error == ImageUploadError::None && state->bytesWritten != state->total)
    {
        error = ImageUploadError::InvalidSize;
    }

    delete state;

    if (error != ImageUploadError::None)
    {
        removeDataFile("/image.upload");
        logEvent("image upload failed", imageUploadErrorMessage(error));
        return { false, error, imageUploadErrorMessage(error) };
    }

    removeDataFile("/image.previous");

    // The old picture's source goes first, so it's never left with a new one.
    removeDataFile(sourcePath);

    if (
        DataFS.exists("/image.bin") &&
        !DataFS.rename("/image.bin", "/image.previous")
    )
    {
        removeDataFile("/image.upload");
        error = ImageUploadError::ReplaceFailed;
        logEvent("image upload failed", imageUploadErrorMessage(error));
        return { false, error, imageUploadErrorMessage(error) };
    }

    if (!DataFS.rename("/image.upload", "/image.bin"))
    {
        DataFS.rename("/image.previous", "/image.bin");
        error = ImageUploadError::SaveFailed;
        logEvent("image upload failed", imageUploadErrorMessage(error));
        return { false, error, imageUploadErrorMessage(error) };
    }

    removeDataFile("/image.previous");

    if (!source.isEmpty())
    {
        saveImageSource(source);
    }

    logEventNow("image uploaded", wholeScreen ? "400 x 600" : "400 x 400");

    if (redraw)
    {
        requestImageUpdate("upload");
    }

    return { true, ImageUploadError::None, "The display image was uploaded successfully." };
}

void cancelImageUpload(ImageUploadState* state, const char* reason)
{
    if (!state)
    {
        return;
    }

    if (state->file)
    {
        state->file.close();
    }

    removeDataFile("/image.upload");
    delete state;

    logEvent("image upload failed", reason);
}

void requestImageUpdate(const char* reason)
{
    imageUpdateReason = reason;
    imageUpdatePending = true;
}

void requestForcedImageUpdate()
{
    imageUpdateReason = "forced refresh";
    forcedImageUpdatePending = true;
    imageUpdatePending = true;
}

bool clearScreenImage()
{
    return removeDataFile("/image.bin") &&
        removeDataFile(sourcePath) &&
        removeDataFile(displayedImageCrcPath);
}

void processImageManager()
{
    if (!imageUpdatePending)
    {
        return;
    }

    bool force = forcedImageUpdatePending;
    const char* reason = imageUpdateReason;

    forcedImageUpdatePending = false;
    imageUpdatePending = false;

    updateDisplay(force, reason);
}

static bool displayedImageCrcMatches(uint32_t imageCrc)
{
    if (!DataFS.exists(displayedImageCrcPath))
    {
        return false;
    }

    File file = DataFS.open(displayedImageCrcPath, "r");
    if (!file || file.size() != sizeof(imageCrc))
    {
        return false;
    }

    uint32_t displayedImageCrc = 0;
    size_t bytesRead = file.read(
        reinterpret_cast<uint8_t*>(&displayedImageCrc),
        sizeof(displayedImageCrc)
    );
    file.close();

    return bytesRead == sizeof(displayedImageCrc) &&
        displayedImageCrc == imageCrc;
}

static bool saveDisplayedImageCrc(uint32_t imageCrc)
{
    removeDataFile(pendingDisplayedImageCrcPath);

    File file = DataFS.open(pendingDisplayedImageCrcPath, "w");
    if (!file)
    {
        return false;
    }

    size_t bytesWritten = file.write(
        reinterpret_cast<const uint8_t*>(&imageCrc),
        sizeof(imageCrc)
    );
    file.close();

    if (bytesWritten != sizeof(imageCrc))
    {
        removeDataFile(pendingDisplayedImageCrcPath);
        return false;
    }

    removeDataFile(displayedImageCrcPath);
    if (!DataFS.rename(
        pendingDisplayedImageCrcPath,
        displayedImageCrcPath
    ))
    {
        removeDataFile(pendingDisplayedImageCrcPath);
        return false;
    }

    return true;
}

static void updateDisplay(bool force, const char* reason)
{
    Serial.println("Updating display");

    // Every redraw shows the strip's latest values, whatever its reason.
    Strip::Values strip = stripValues();
    drawScreen(force, reason, strip);
    stripShown(strip);
}

static void drawScreen(bool force, const char* reason, const Strip::Values& strip)
{
    bool imageSaved = DataFS.exists("/image.bin");
    // In place of the picture while there's none, or to check it on the screen
    SetupHelp::Screen help = setupHelpToDraw(imageSaved);
    // With no laser on purpose, the picture is the whole screen, with no strip.
    // A test may be of a laser that isn't the tap's own, so it decides meanwhile.
    bool wholeScreen = pictureFillsScreen();

    if (help != SetupHelp::Screen::None)
    {
        Serial.println("Drawing the setup help...");

        // In the middle of the whole screen, on white, like a square picture
        uint8_t* square = screenBuffer;
        if (wholeScreen)
        {
            memset(screenBuffer, (Strip::White << 4) | Strip::White, SCREEN_SIZE);
            square += ScreenLayout::BandBytes;
        }

        if (!drawSetupHelp(square, help, false))
        {
            logEvent("redraw failed", String(reason) + ", unable to draw the setup help");
            return;
        }
    }
    else if (!imageSaved)
    {
        logEvent("redraw skipped", String(reason) + ", no image saved");
        return;
    }
    else
    {
        Serial.println("Loading image...");

        if (!loadPicture(screenBuffer, wholeScreen))
        {
            logEvent("redraw failed", String(reason) + ", unable to load the image");
            return;
        }
    }

    // The setup help shown for a test makes the whole screen a test: one red
    // border round all of it, so it's never taken for a tap that really needs
    // setting up, in place of the strip's own.
    bool helpTest = help != SetupHelp::Screen::None && testSetupHelp() != SetupHelp::Screen::None;

    if (!wholeScreen)
    {
        Strip::Values drawn = strip;
        drawn.test = drawn.test && !helpTest;
        Strip::draw(screenBuffer + IMAGE_SIZE, drawn);
    }

    if (helpTest)
    {
        ScreenLayout::drawTestBorder(screenBuffer);
    }

    // Covers the strip too, so a change to it redraws the screen.
    uint32_t imageCrc = esp_crc32_le(0, screenBuffer, SCREEN_SIZE);
    if (!force && displayedImageCrcMatches(imageCrc))
    {
        logEvent("redraw skipped", String(reason) + ", image already displayed");
        return;
    }

    unsigned long startedAt = millis();

    Serial.println("Initialising display...");

    DEV_Module_Init();

    EPD_4IN0E_Init();

    Serial.println("Displaying image...");

    EPD_4IN0E_Display(screenBuffer);

    EPD_4IN0E_Sleep();

    DEV_Module_Exit();

    if (!saveDisplayedImageCrc(imageCrc))
    {
        Serial.println("Failed to save displayed image CRC");
    }

    logEventNow(
        "redraw",
        String(reason) + ", " + String((millis() - startedAt) / 1000.0, 1) + " s, " +
            (wholeScreen ? String("whole screen, no laser") : stripDescription(strip))
    );
}