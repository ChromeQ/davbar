#include "ImageManager.h"

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
    ImageUploadError error;
};

const char* imageUploadErrorMessage(ImageUploadError error)
{
    switch (error)
    {
        case ImageUploadError::InvalidContentType:
            return "Image must be uploaded as application/octet-stream.";
        case ImageUploadError::InvalidSize:
            return "Image must contain exactly 80000 bytes.";
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

    if (total != IMAGE_SIZE)
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

ImageUploadResult finishImageUpload(ImageUploadState* state)
{
    if (state && state->file)
    {
        state->file.close();
    }

    ImageUploadError error = state
        ? state->error
        : ImageUploadError::OpenFailed;

    if (error == ImageUploadError::None && state->bytesWritten != IMAGE_SIZE)
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

    logEvent("image uploaded", "400 x 400");

    requestImageUpdate("upload");

    return { true, ImageUploadError::None, "The display image was uploaded successfully." };
}

void cancelImageUpload(ImageUploadState* state)
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

    logEvent("image upload failed", "the connection closed before it finished");
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
    return removeDataFile("/image.bin") && removeDataFile(displayedImageCrcPath);
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

    if (help != SetupHelp::Screen::None)
    {
        Serial.println("Drawing the setup help...");

        if (!drawSetupHelp(screenBuffer, help, false))
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

        if (!loadImage(screenBuffer))
        {
            logEvent("redraw failed", String(reason) + ", unable to load the image");
            return;
        }
    }

    Strip::draw(screenBuffer + IMAGE_SIZE, strip);

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

    logEvent(
        "redraw",
        String(reason) + ", " + String((millis() - startedAt) / 1000.0, 1) + " s, " +
            stripDescription(strip)
    );
}