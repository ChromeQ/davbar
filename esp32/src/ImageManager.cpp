#include "ImageManager.h"

#include <LittleFS.h>
#include <esp_crc.h>
#include <new>

#include "DEV_Config.h"
#include "EPD_4in0e.h"
#include "ImageLoader.h"

static bool imageUpdatePending = false;

static uint8_t imageBuffer[IMAGE_SIZE];

static const char* displayedImageCrcPath = "/image.displayed.crc";
static const char* pendingDisplayedImageCrcPath = "/image.displayed.crc.tmp";

static bool displayedImageCrcMatches(uint32_t imageCrc);
static bool saveDisplayedImageCrc(uint32_t imageCrc);
static void updateDisplay();

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
            return "Image must contain exactly 120000 bytes.";
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

    LittleFS.remove("/image.upload");
    state->file = LittleFS.open("/image.upload", "w");

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
        LittleFS.remove("/image.upload");
        return { false, error, imageUploadErrorMessage(error) };
    }

    LittleFS.remove("/image.previous");

    if (
        LittleFS.exists("/image.bin") &&
        !LittleFS.rename("/image.bin", "/image.previous")
    )
    {
        LittleFS.remove("/image.upload");
        error = ImageUploadError::ReplaceFailed;
        return { false, error, imageUploadErrorMessage(error) };
    }

    if (!LittleFS.rename("/image.upload", "/image.bin"))
    {
        LittleFS.rename("/image.previous", "/image.bin");
        error = ImageUploadError::SaveFailed;
        return { false, error, imageUploadErrorMessage(error) };
    }

    LittleFS.remove("/image.previous");

    Serial.printf("Image upload complete (%u bytes)\n", IMAGE_SIZE);

    requestImageUpdate();

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

    LittleFS.remove("/image.upload");
    delete state;
}

void requestImageUpdate()
{
    imageUpdatePending = true;
}

void processImageManager()
{
    if (!imageUpdatePending)
    {
        return;
    }

    imageUpdatePending = false;

    updateDisplay();
}

static bool displayedImageCrcMatches(uint32_t imageCrc)
{
    File file = LittleFS.open(displayedImageCrcPath, "r");
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
    LittleFS.remove(pendingDisplayedImageCrcPath);

    File file = LittleFS.open(pendingDisplayedImageCrcPath, "w");
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
        LittleFS.remove(pendingDisplayedImageCrcPath);
        return false;
    }

    LittleFS.remove(displayedImageCrcPath);
    if (!LittleFS.rename(
        pendingDisplayedImageCrcPath,
        displayedImageCrcPath
    ))
    {
        LittleFS.remove(pendingDisplayedImageCrcPath);
        return false;
    }

    return true;
}

static void updateDisplay()
{
    Serial.println("Updating display");

    Serial.println("Loading image...");

    if (!loadImage(imageBuffer))
    {
        Serial.println("Failed to load image");
        return;
    }

    uint32_t imageCrc = esp_crc32_le(0, imageBuffer, IMAGE_SIZE);
    if (displayedImageCrcMatches(imageCrc))
    {
        Serial.println("Image is already displayed");
        return;
    }

    Serial.println("Initialising display...");

    DEV_Module_Init();

    EPD_4IN0E_Init();

    Serial.println("Displaying image...");

    EPD_4IN0E_Display(imageBuffer);

    EPD_4IN0E_Sleep();

    DEV_Module_Exit();

    if (!saveDisplayedImageCrc(imageCrc))
    {
        Serial.println("Failed to save displayed image CRC");
    }

    Serial.println("Display update complete");
}