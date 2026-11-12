#pragma once

// The setup help, drawn in place of a picture when the tap has none: a newly
// flashed tap, or one just factory reset (PLAN.md, step 7). First how to join the
// tap's own Wi-Fi to set it up, then, once it's on the home Wi-Fi, where to send
// a picture. Never in place of a saved picture.
//
// It has no Arduino code, so it is tested on the laptop too (pio test -e
// native). The QR code's modules come from the caller, as the generator is the
// ESP32's own.

#include <stddef.h>
#include <stdint.h>
#include <string>

namespace SetupHelp
{
    // The picture's square, above the strip.
    constexpr int Width = 400;
    constexpr int Height = 400;
    constexpr size_t Size = Width / 2 * Height;

    enum class Screen : uint8_t
    {
        // A picture shows instead, or the tap is still joining its Wi-Fi.
        None,
        // Not on Wi-Fi: join the tap's own network, which opens the setup page.
        JoinWifi,
        // On Wi-Fi, with no picture yet: where to send one.
        Ready,
    };

    // The screen for the tap's Wi-Fi: the ready help once it's on Wi-Fi, the
    // Wi-Fi help while its own network is open instead, and none while it's
    // still joining, so a tap that will join in a moment doesn't redraw twice.
    Screen screenFor(bool wifiConnected, bool accessPointOpen);

    struct Details
    {
        // "Tap 2"
        const char* tapName;
        // The tap's own network, "DavBar Tap 2", and its password.
        const char* network;
        const char* password;
        // "davbar-tap2.local"
        const char* host;
        // "192.168.0.112"
        const char* ip;
    };

    // What the QR code holds: the tap's network in the WIFI: form phone cameras
    // offer to join, or the page's address by IP, which works on any phone on
    // the same Wi-Fi, where some can't open .local names.
    std::string qrText(Screen screen, const Details& details);

    // A QR code's modules: size x size, row by row, 1 bit each, the most
    // significant bit first.
    struct QrCode
    {
        int size;
        const uint8_t* modules;

        bool dark(int x, int y) const;
    };

    // The bytes a QR code of this size needs.
    constexpr size_t qrBytes(int size)
    {
        return (static_cast<size_t>(size) * size + 7) / 8;
    }

    // Draws the screen, in black and white, into image: Size bytes, 2 pixels a
    // byte like the rest of the screen. hidePassword writes "shown on the tap"
    // instead of the password, for the web app's preview.
    void draw(
        uint8_t* image,
        Screen screen,
        const Details& details,
        const QrCode& qr,
        bool hidePassword
    );
}
