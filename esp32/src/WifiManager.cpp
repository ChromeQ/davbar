#include "WifiManager.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <ESPAsyncWebServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <WiFi.h>

#include "DeviceConfig.h"
#include "ImageManager.h"

static AsyncWebServer server(80);

static DNSServer dnsServer;

static String ssid;
static String password;
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

static bool loadCredentials()
{
    if (!LittleFS.exists("/wifi.json"))
    {
        Serial.println("No WiFi credentials found");
        return false;
    }

    Serial.println("Opening wifi.json"); // TMP
    File file = LittleFS.open("/wifi.json", "r");
    if (!file)
    {
        Serial.println("Failed to open wifi.json");
        return false;
    }

    JsonDocument doc;

    DeserializationError error =
        deserializeJson(doc, file);

    file.close();

    if (error)
    {
        Serial.println("Invalid wifi.json");
        return false;
    }

    ssid = doc["ssid"].as<String>();
    password = doc["password"].as<String>();

    return !ssid.isEmpty();
}

static void saveCredentials(
    const String& newSsid,
    const String& newPassword
)
{
    JsonDocument doc;

    doc["ssid"] = newSsid;
    doc["password"] = newPassword;

    File file = LittleFS.open(
        "/wifi.json",
        "w"
    );

    serializeJson(doc, file);

    file.close();
}

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
    if (LittleFS.exists("/wifi.json") && !LittleFS.remove("/wifi.json"))
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

    startWebServer();
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
            Serial.println("WiFi test successful");
            saveCredentials(pendingSsid, pendingPassword);
            connectionState = ConnectionState::Success;
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

    wifi_mode_t mode = WiFi.getMode();

    if (mode == WIFI_AP || mode == WIFI_AP_STA)
    {
        dnsServer.processNextRequest();
    }
}

bool connectWifi()
{
    if (!loadCredentials())
    {
        Serial.println("No WiFi configured");

        startAccessPoint();

        return false;
    }

    WiFi.mode(WIFI_STA);
    dnsServer.stop();

    Serial.print("Connecting to ");
    Serial.print(ssid);
    Serial.println("...");

    WiFi.begin(
        ssid.c_str(),
        password.c_str()
    );

    for (int i = 0; i < 30; i++)
    {
        if (WiFi.status() == WL_CONNECTED)
        {
            Serial.println();
            Serial.println("Connected to WiFi");
            Serial.print("IP address: ");
            Serial.println(WiFi.localIP());

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

            return true;
        }

        Serial.print(".");

        delay(500);
    }

    Serial.println();
    Serial.println("Connection failed");

    startAccessPoint();

    return false;
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

    server.onNotFound(
        [](AsyncWebServerRequest *request)
        {
            request->redirect("/");
        }
    );

    server.begin();

    Serial.println("HTTP server started");
}
