#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <SetupHelp.h>

// The setup help on this tap (lib/Strip/SetupHelp.h): which screen it shows in
// place of a picture while it has none, drawn with this tap's details and a QR
// code from the ESP32's generator.
//
//   GET /setup-help?screen=join|ready   the screen as the tap draws it, for
//                                       developer mode's preview in the web
//                                       app: IMAGE_SIZE bytes, like GET /image,
//                                       with the password left out of its text
//                                       and its QR code.

// Asks for a redraw when the Wi-Fi calls for another screen and the tap has no
// picture. Call from loop().
void processSetupHelp();

// What the screen shows in place of the picture: the test screen while "Show on
// device" shows one, otherwise the Wi-Fi's screen when no picture is saved, or
// None for the picture. From the loop.
SetupHelp::Screen setupHelpToDraw(bool imageSaved);

// Draws a screen with this tap's details into image, SetupHelp::Size bytes.
// hidePassword leaves the password out, for the web app's preview. False if its
// QR code couldn't be made.
bool drawSetupHelp(uint8_t* image, SetupHelp::Screen screen, bool hidePassword);

// The web app's names for the screens: "join" and "ready", and "" for None.
// False for any other name.
bool parseSetupHelpScreen(const String& name, SetupHelp::Screen& screen);

void addSetupHelpRoutes(AsyncWebServer& server);
