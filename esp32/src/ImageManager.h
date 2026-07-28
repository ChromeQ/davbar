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

ImageUploadResult finishImageUpload(ImageUploadState* state);

void cancelImageUpload(ImageUploadState* state);

void requestImageUpdate();

void requestForcedImageUpdate();

void processImageManager();