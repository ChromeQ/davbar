#include "SetupHelpManager.h"

#include <atomic>
#include <mutex>
#include <qrcode.h>
#include <string.h>

#include "DeviceConfig.h"
#include "ImageManager.h"
#include "LibraryManager.h"
#include "Screen.h"
#include "Storage.h"
#include "StripManager.h"
#include "WifiManager.h"

using SetupHelp::Screen;

static_assert(SetupHelp::Size == IMAGE_SIZE, "The setup help fills the picture's square");

// QR codes up to version 10, 57 modules a side: room for a network name of 32
// characters and a password of 63, the most Wi-Fi allows, even with every
// character escaped. Medium error correction copes with a smudged screen.
static const int maxQrVersion = 10;
static const int maxQrSize = maxQrVersion * 4 + 17;

// The ESP32's generator hands each code to a function rather than returning it,
// so it's copied here. The loop and the web server's task both make codes, so
// one at a time.
static std::mutex qrLock;
static uint8_t qrModules[SetupHelp::qrBytes(maxQrSize)];
static int qrSize = 0;

static void copyQrCode(esp_qrcode_handle_t code)
{
    int size = esp_qrcode_get_size(code);
    if (size <= 0 || size > maxQrSize)
    {
        qrSize = 0;
        return;
    }

    memset(qrModules, 0, sizeof(qrModules));
    for (int y = 0; y < size; y++)
    {
        for (int x = 0; x < size; x++)
        {
            if (esp_qrcode_get_module(code, x, y))
            {
                int bit = y * size + x;
                qrModules[bit / 8] |= 0x80 >> (bit % 8);
            }
        }
    }
    qrSize = size;
}

bool drawSetupHelp(uint8_t* image, Screen screen, bool hidePassword)
{
    String host = String(DeviceConfig::MdnsHostname) + ".local";
    String ip = wifiIpAddress();
    SetupHelp::Details details = {
        DeviceConfig::DeviceName,
        DeviceConfig::AccessPointName,
        DeviceConfig::AccessPointPassword,
        host.c_str(),
        ip.c_str(),
    };

    // The preview's QR code has a stand-in, so scanning it gives nothing away.
    SetupHelp::Details coded = details;
    if (hidePassword)
    {
        coded.password = "shown-on-the-tap";
    }
    std::string text = SetupHelp::qrText(screen, coded);

    std::lock_guard<std::mutex> lock(qrLock);
    qrSize = 0;

    if (!text.empty())
    {
        esp_qrcode_config_t config = {copyQrCode, maxQrVersion, ESP_QRCODE_ECC_MED};
        if (esp_qrcode_generate(&config, text.c_str()) != ESP_OK || qrSize == 0)
        {
            return false;
        }
    }

    SetupHelp::draw(image, screen, details, {qrSize, qrModules}, hidePassword);
    return true;
}

bool parseSetupHelpScreen(const String& name, Screen& screen)
{
    if (name.isEmpty())
    {
        screen = Screen::None;
    }
    else if (name == "join")
    {
        screen = Screen::JoinWifi;
    }
    else if (name == "ready")
    {
        screen = Screen::Ready;
    }
    else
    {
        return false;
    }

    return true;
}

static Screen wifiScreen()
{
    return SetupHelp::screenFor(wifiIsConnected(), setupAccessPointIsOpen());
}

Screen setupHelpToDraw(bool imageSaved)
{
    Screen test = testSetupHelp();
    if (test != Screen::None)
    {
        return test;
    }

    return imageSaved ? Screen::None : wifiScreen();
}

// What the Wi-Fi last called for, checked each second.
static Screen lastScreen = Screen::None;
static String lastIp;
static unsigned long lastCheckAt = 0;

void processSetupHelp()
{
    unsigned long now = millis();
    if (now - lastCheckAt < 1000)
    {
        return;
    }
    lastCheckAt = now;

    Screen screen = wifiScreen();
    String ip = screen == Screen::Ready ? wifiIpAddress() : String();
    if (screen == lastScreen && ip == lastIp)
    {
        return;
    }
    lastScreen = screen;
    lastIp = ip;

    // While the tap is still joining, the screen stays as it is. The image file
    // is only checked on a change, as LittleFS is slow.
    if (screen != Screen::None && !DataFS.exists("/image.bin"))
    {
        requestImageUpdate("setup help");
    }
}

// The preview's pixels, in PSRAM, kept until the response has gone; one preview
// at a time.
static uint8_t* previewImage = nullptr;
static std::atomic<bool> previewBusy{false};

static void handlePreview(AsyncWebServerRequest* request)
{
    Screen screen;
    if (!parseSetupHelpScreen(request->arg("screen"), screen) || screen == Screen::None)
    {
        request->send(400, "text/plain", "The screen must be join or ready.");
        return;
    }

    if (previewBusy.exchange(true))
    {
        request->send(503, "text/plain", "Busy with another preview. Try again.");
        return;
    }

    if (!previewImage)
    {
        previewImage = static_cast<uint8_t*>(ps_malloc(SetupHelp::Size));
    }

    if (!previewImage || !drawSetupHelp(previewImage, screen, true))
    {
        previewBusy = false;
        request->send(500, "text/plain", "Unable to draw the setup help.");
        return;
    }

    AsyncWebServerResponse* response = request->beginResponse(
        200,
        "application/octet-stream",
        previewImage,
        SetupHelp::Size
    );
    response->addHeader("Cache-Control", "no-store");
    request->onDisconnect([]() { previewBusy = false; });
    request->send(response);
}

void addSetupHelpRoutes(AsyncWebServer& server)
{
    server.on(AsyncURIMatcher::exact("/setup-help"), HTTP_GET, handlePreview)
        .addMiddleware(allowLocalPages);
}
