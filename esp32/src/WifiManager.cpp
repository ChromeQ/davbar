#include "WifiManager.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <ESPAsyncWebServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <esp_timer.h>
#include <time.h>

#include "DeviceConfig.h"
#include "ImageManager.h"
#include "Settings.h"
#include "Storage.h"

static AsyncWebServer server(80);

static DNSServer dnsServer;

// With saved WiFi, retry every 30s forever. After 5 minutes without WiFi, also
// open the setup access point so the network can be changed.
static const unsigned long wifiRetryInterval = 30000;
static const unsigned long fallbackAccessPointDelay = 5UL * 60 * 1000;

static String ssid;
static String password;
static bool hasSavedWifi = false;
static bool wifiConnected = false;
static bool networkServicesStarted = false;
static unsigned long lastWifiAttemptAt = 0;
static unsigned long wifiOfflineSince = 0;
static unsigned long restartAt = 0;

enum class ConnectionState
{
    Idle,
    Connecting,
    Success,
    Failure
};

static ConnectionState connectionState = ConnectionState::Idle;
static String pendingSsid;
static String pendingPassword;
static unsigned long connectionStartedAt = 0;

static void handleRoot(AsyncWebServerRequest* request)
{
    wifi_mode_t mode = WiFi.getMode();

    if (mode == WIFI_AP || mode == WIFI_AP_STA)
    {
        request->send(
            LittleFS,
            "/connect.html",
            "text/html"
        );
    }
    else
    {
        request->send(
            LittleFS,
            "/index.html",
            "text/html"
        );
    }
}

static void handleScan(AsyncWebServerRequest* request)
{
    int count = WiFi.scanComplete();

    if (count == WIFI_SCAN_RUNNING)
    {
        request->send(
            202,
            "application/json",
            R"({"scanning":true})"
        );

        return;
    }

    if (count == WIFI_SCAN_FAILED)
    {
        Serial.println("Starting WiFi network scan...");

        if (WiFi.scanNetworks(true) == WIFI_SCAN_FAILED)
        {
            request->send(
                500,
                "application/json",
                R"({"error":"Unable to start WiFi scan"})"
            );

            return;
        }

        request->send(
            202,
            "application/json",
            R"({"scanning":true})"
        );

        return;
    }

    Serial.printf("WiFi scan found %d networks\n", count);

    JsonDocument doc;

    JsonArray networks = doc["networks"].to<JsonArray>();

    for (int i = 0; i < count; i++)
    {
        JsonObject network = networks.add<JsonObject>();

        network["ssid"] = WiFi.SSID(i);
        network["rssi"] = WiFi.RSSI(i);
        network["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    }

    String response;

    serializeJson(doc, response);

    WiFi.scanDelete();

    request->send(
        200,
        "application/json",
        response
    );
}

static void handleConnect(AsyncWebServerRequest* request)
{
    if (connectionState == ConnectionState::Connecting)
    {
        request->send(
            409,
            "application/json",
            R"({"success":false,"message":"A WiFi connection is already being tested"})"
        );

        return;
    }

    pendingSsid = request->arg("ssid");
    pendingPassword = request->arg("password");

    if (pendingSsid.isEmpty())
    {
        request->send(
            400,
            "application/json",
            R"({"success":false,"message":"Select a WiFi network"})"
        );

        return;
    }

    Serial.printf("Testing WiFi '%s'\n", pendingSsid.c_str());

    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(
        pendingSsid.c_str(),
        pendingPassword.c_str()
    );

    connectionStartedAt = millis();
    connectionState = ConnectionState::Connecting;

    request->send(
        202,
        "application/json",
        R"({"connecting":true})"
    );
}

static void handleConnectStatus(AsyncWebServerRequest* request)
{
    if (connectionState == ConnectionState::Connecting)
    {
        request->send(
            202,
            "application/json",
            R"({"connecting":true})"
        );

        return;
    }

    if (connectionState == ConnectionState::Success)
    {
        request->send(
            200,
            "application/json",
            R"({"success":true,"message":"Saved. Rebooting..."})"
        );

        restartAt = millis() + 1000;
        return;
    }

    if (connectionState == ConnectionState::Failure)
    {
        connectionState = ConnectionState::Idle;
        request->send(
            400,
            "application/json",
            R"({"success":false,"message":"Unable to connect. Check the password and try again."})"
        );

        return;
    }

    request->send(
        409,
        "application/json",
        R"({"success":false,"message":"No WiFi connection is being tested"})"
    );
}

static void handleForgetWifi(AsyncWebServerRequest* request)
{
    if (!clearWifiSettings())
    {
        request->send(
            500,
            "application/json",
            R"({"success":false,"message":"Unable to remove saved WiFi"})"
        );

        return;
    }

    ssid = "";
    password = "";

    request->send(
        200,
        "application/json",
        R"({"success":true,"message":"Saved WiFi forgotten. Rebooting..."})"
    );

    Serial.println("WiFi credentials removed. Rebooting...");
    restartAt = millis() + 1000;
}

static void handleRefreshDisplay(AsyncWebServerRequest* request)
{
    requestForcedImageUpdate();

    request->send(
        200,
        "application/json",
        R"({"success":true,"message":"Display refresh requested."})"
    );
}

static void handleReboot(AsyncWebServerRequest* request)
{
    request->send(
        200,
        "application/json",
        R"({"success":true,"message":"Device reboot requested."})"
    );

    Serial.println("Device reboot requested");
    restartAt = millis() + 1000;
}

static void handleStatus(AsyncWebServerRequest* request)
{
    String hostname = String(DeviceConfig::Hostname) + "-" + DeviceConfig::DeviceId;

    JsonDocument doc;
    doc["hostname"] = hostname;
    doc["ip"] = WiFi.localIP().toString();
    doc["wifi"]["ssid"] = WiFi.SSID();
    doc["wifi"]["rssi"] = WiFi.RSSI();

    File image = DataFS.open("/image.bin", "r");
    if (image)
    {
        doc["image"]["size"] = image.size();

        time_t updatedAt = image.getLastWrite();
        struct tm updatedAtUtc;
        char updatedAtText[21];

        if (
            updatedAt >= 1609459200 &&
            gmtime_r(&updatedAt, &updatedAtUtc) &&
            strftime(
                updatedAtText,
                sizeof(updatedAtText),
                "%Y-%m-%dT%H:%M:%SZ",
                &updatedAtUtc
            ) > 0
        )
        {
            doc["image"]["updated"] = updatedAtText;
        }
        else
        {
            doc["image"]["updated"] = nullptr;
        }

        image.close();
    }
    else
    {
        doc["image"]["updated"] = nullptr;
        doc["image"]["size"] = 0;
    }

    doc["uptime"] = static_cast<uint64_t>(esp_timer_get_time()) / 1000000;

    String payload;
    serializeJson(doc, payload);

    AsyncWebServerResponse* response = request->beginResponse(
        200,
        "application/json",
        payload
    );
    response->addHeader("Cache-Control", "no-store");
    request->send(response);
}

static void handleImageUpload(
    AsyncWebServerRequest* request,
    uint8_t* data,
    size_t len,
    size_t index,
    size_t total
)
{
    if (index == 0)
    {
        Serial.println("Starting upload: image.bin");
        request->_tempObject = beginImageUpload(
            request->contentType(),
            total
        );

        request->onDisconnect(
            [request]()
            {
                cancelImageUpload(
                    static_cast<ImageUploadState*>(request->_tempObject)
                );
                request->_tempObject = nullptr;
            }
        );
    }

    writeImageUploadChunk(
        static_cast<ImageUploadState*>(request->_tempObject),
        data,
        len,
        index
    );
}

static void handleImageUploadFinished(AsyncWebServerRequest* request)
{
    ImageUploadState* state = static_cast<ImageUploadState*>(request->_tempObject);
    ImageUploadResult result = finishImageUpload(state);
    request->_tempObject = nullptr;

    Serial.printf(
        "Image upload %s: %s\n",
        result.success ? "complete" : "failed",
        result.message
    );

    JsonDocument doc;
    doc["success"] = result.success;
    doc["message"] = result.message;
    String response;
    serializeJson(doc, response);

    bool clientError =
        result.error == ImageUploadError::InvalidContentType ||
        result.error == ImageUploadError::InvalidSize ||
        result.error == ImageUploadError::OutOfOrder;

    request->send(
        result.success ? 200 : clientError ? 400 : 500,
        "application/json",
        response
    );
}

static void startAccessPoint()
{
    Serial.println("Starting setup AP");

    WiFi.mode(WIFI_AP_STA);

    WiFi.softAP(
        DeviceConfig::AccessPointName,
        DeviceConfig::AccessPointPassword
    );

    dnsServer.start(
        53,
        "*",
        WiFi.softAPIP()
    );

    Serial.print("Setup IP: ");
    Serial.println(WiFi.softAPIP());
}

static bool accessPointOpen()
{
    wifi_mode_t mode = WiFi.getMode();

    return mode == WIFI_AP || mode == WIFI_AP_STA;
}

static void stopAccessPoint()
{
    Serial.println("Closing setup AP");

    dnsServer.stop();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_STA);
}

static void beginSavedWifi()
{
    Serial.printf("Connecting to %s...\n", ssid.c_str());

    WiFi.begin(
        ssid.c_str(),
        password.c_str()
    );

    lastWifiAttemptAt = millis();
}

static void startNetworkServices()
{
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");

    String mdnsHostname = String(DeviceConfig::Hostname) + "-" + DeviceConfig::DeviceId;

    if (!MDNS.begin(mdnsHostname.c_str()))
    {
        Serial.println("Failed to start mDNS");
    }
    else
    {
        Serial.println("mDNS started");
        Serial.printf("Visit: http://%s.local\n", mdnsHostname.c_str());
    }
}

static void onWifiConnected()
{
    wifiConnected = true;

    Serial.print("Connected to WiFi, IP address: ");
    Serial.println(WiFi.localIP());

    if (accessPointOpen())
    {
        stopAccessPoint();
    }

    if (!networkServicesStarted)
    {
        startNetworkServices();
        networkServicesStarted = true;
    }
}

static void onWifiLost()
{
    wifiConnected = false;
    wifiOfflineSince = millis();

    Serial.println("WiFi connection lost");
}

static void processSavedWifi()
{
    // A network chosen on the setup page is being tested; leave it alone.
    if (!hasSavedWifi || connectionState == ConnectionState::Connecting)
    {
        return;
    }

    bool connected = WiFi.status() == WL_CONNECTED;

    if (connected && !wifiConnected)
    {
        onWifiConnected();
    }
    else if (!connected && wifiConnected)
    {
        onWifiLost();
    }

    if (connected)
    {
        return;
    }

    unsigned long now = millis();

    if (!accessPointOpen() && now - wifiOfflineSince >= fallbackAccessPointDelay)
    {
        Serial.println("No WiFi for 5 minutes");
        startAccessPoint();
    }

    // Searching for the router disturbs the access point, so don't retry while
    // a phone is connected to it.
    if (accessPointOpen() && WiFi.softAPgetStationNum() > 0)
    {
        return;
    }

    if (now - lastWifiAttemptAt >= wifiRetryInterval)
    {
        WiFi.disconnect();
        beginSavedWifi();
    }
}

void processWifiManager()
{
    if (restartAt != 0 && static_cast<long>(millis() - restartAt) >= 0)
    {
        ESP.restart();
    }

    if (connectionState == ConnectionState::Connecting)
    {
        wl_status_t status = WiFi.status();

        if (status == WL_CONNECTED)
        {
            if (saveWifiSettings(pendingSsid, pendingPassword))
            {
                Serial.println("WiFi test successful");
                connectionState = ConnectionState::Success;
            }
            else
            {
                Serial.println("WiFi test successful, but saving it failed");
                WiFi.disconnect(false, true);
                connectionState = ConnectionState::Failure;
            }
        }
        else if (
            status == WL_CONNECT_FAILED ||
            status == WL_NO_SSID_AVAIL ||
            millis() - connectionStartedAt >= 20000
        )
        {
            Serial.println("WiFi test failed");
            WiFi.disconnect(false, true);
            connectionState = ConnectionState::Failure;
        }
    }

    processSavedWifi();

    if (accessPointOpen())
    {
        dnsServer.processNextRequest();
    }
}

void startWifi()
{
    // Retries are timed here rather than by the WiFi library, and the network
    // is saved in our own settings rather than the library's.
    WiFi.persistent(false);
    WiFi.setAutoReconnect(false);

    hasSavedWifi = loadWifiSettings(ssid, password);

    if (!hasSavedWifi)
    {
        Serial.println("No WiFi configured");

        startAccessPoint();

        return;
    }

    WiFi.mode(WIFI_STA);
    wifiOfflineSince = millis();
    beginSavedWifi();
}

void startWebServer()
{
    server.serveStatic(
        "/assets/",
        LittleFS,
        "/assets/"
    ).setTryGzipFirst(false);

    server.on(
        "/",
        HTTP_GET,
        handleRoot
    );

    server.on(
        "/scan",
        HTTP_GET,
        handleScan
    );

    server.on(
        "/connect",
        HTTP_POST,
        handleConnect
    );

    server.on(
        "/connect",
        HTTP_GET,
        handleConnectStatus
    );

    server.on(
        "/wifi",
        HTTP_DELETE,
        handleForgetWifi
    );

    server.on(
        "/image",
        HTTP_POST,
        handleImageUploadFinished,
        nullptr,
        handleImageUpload
    );

    server.on(
        "/refresh",
        HTTP_POST,
        handleRefreshDisplay
    );

    server.on(
        "/reboot",
        HTTP_POST,
        handleReboot
    );

    server.on(
        "/status",
        HTTP_GET,
        handleStatus
    );

    server.onNotFound(
        [](AsyncWebServerRequest *request)
        {
            request->redirect("/");
        }
    );

    server.begin();

    Serial.println("HTTP server started");
}
