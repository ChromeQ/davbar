#pragma once

#include <Arduino.h>

enum class ImageUploadError
{
	None,
	InvalidContentType,
	InvalidSize,
	OpenFailed,
	OutOfOrder,
	WriteFailed,
	ReplaceFailed,
	SaveFailed
};

struct ImageUploadState;

struct ImageUploadResult
{
	bool success;
	ImageUploadError error;
	const char* message;
};

const char* imageUploadErrorMessage(ImageUploadError error);

ImageUploadState* beginImageUpload(
	const String& contentType,
	size_t total
);

void writeImageUploadChunk(
	ImageUploadState* state,
	const uint8_t* data,
	size_t len,
	size_t index
);

// The longest description of how the web app drew a picture (finishImageUpload).
constexpr size_t MaxImageSourceLength = 1024;

// Saves the picture and redraws, or with redraw false leaves the redraw to
// whatever else changed with it, such as the laser (PLAN.md, step 8d). source,
// if the web app drew the picture (a keg state or text), says how, so it can draw
// it again for the other layout (PLAN.md, step 8f). It's kept with the picture,
// unread, and goes when another picture replaces it. At most
// MaxImageSourceLength; the caller checks.
ImageUploadResult finishImageUpload(
	ImageUploadState* state,
	bool redraw = true,
	const String& source = String()
);

// The saved picture's source (finishImageUpload), or empty if there's none.
String imageSource();

// Throws the upload away, logging why.
void cancelImageUpload(
	ImageUploadState* state,
	const char* reason = "the connection closed before it finished"
);

// Redraws the saved image if it differs from the one on screen. The reason,
// such as "upload", goes in the device log.
void requestImageUpdate(const char* reason);

void requestForcedImageUpdate();

// Removes the saved image and its source, for a factory reset. The screen keeps
// showing it.
bool clearScreenImage();

void processImageManager();