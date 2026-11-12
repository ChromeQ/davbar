#pragma once

#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>

// The beer library: up to BeerLibrary::Capacity beers in the data partition, kept
// over uploads, updates and restarts. The web app does all the image work; this
// stores, lists and removes them (see lib/BeerLibrary for the rules).
//
//   GET  /library            {"capacity", "beers": [{"id", "shownAt"}]}, last
//                            shown first. shownAt is null if the clock wasn't
//                            set.
//   GET  /library/<id>.jpg   the picture, and <id>.thumb.jpg its thumbnail
//   POST /library            multipart, with files named image.jpg and
//                            thumbnail.jpg. Saves the beer, or marks it shown now
//                            if this tap has it. 409 with "full" when full.
//   POST /library/remove     ids=<id>,<id>: removes those beers, at most 10
//
// Pages on the local network, such as another tap's, may use these routes.

// Makes the library's folder, removes any half-finished upload and reads which
// beers this tap has. Call after mountStorage() and before the web server
// starts.
void startLibrary();

void addLibraryRoutes(AsyncWebServer& server);

// Middleware that lets pages on the local network, such as another tap's or the
// web app's dev server, read a route's answer.
void allowLocalPages(AsyncWebServerRequest* request, ArMiddlewareNext next);

// For /status: how many beers this tap has, of how many.
void addLibraryStatus(JsonObject library);

// Removes every beer, for a factory reset that asks for it.
bool clearLibrary();
