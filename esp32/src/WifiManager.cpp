#include <ArduinoJson.h>
#include <DNSServer.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <WiFi.h>

#include "WifiManager.h"

static AsyncWebServer server(80);

static DNSServer dnsServer;

static String ssid;
static String password;
static unsigned long restartAt = 0;

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

static bool testWifiConnection(
    const String& ssid,
    const String& password
)
{
    Serial.printf("Testing WiFi '%s'\n", ssid.c_str());

    WiFi.mode(WIFI_AP_STA);

    WiFi.begin(
        ssid.c_str(),
        password.c_str()
    );

    unsigned long start = millis();

    while (millis() - start < 10000)
    {
        if (WiFi.status() == WL_CONNECTED)
        {
            Serial.println("WiFi test successful");

            WiFi.disconnect(true);

            return true;
        }

        delay(250);
    }

    Serial.println("WiFi test failed");

    WiFi.disconnect(true);

    return false;
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
    Serial.println("Scanning WiFi networks...");

    int count = WiFi.scanNetworks();

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
    String newSsid =
        request->arg("ssid");

    String newPassword =
        request->arg("password");

    if (!testWifiConnection(newSsid, newPassword))
    {
        request->send(
            400,
            "application/json",
            R"({
                "success": false,
                "message": "Unable to connect to WiFi"
            })"
        );

        return;
    }

    saveCredentials(
        newSsid,
        newPassword
    );

    request->send(
        200,
        "application/json",
        R"({
            "success": true,
            "message": "Saved. Rebooting..."
        })"
    );

    Serial.println("Credentials saved. Rebooting...");
    restartAt = millis() + 1000;
}

static void handleStatus(AsyncWebServerRequest* request)
{
    JsonDocument doc;

    doc["device"] = "tap1";
    doc["wifi"] = true;
    doc["ssid"] = WiFi.SSID();
    doc["ip"] = WiFi.localIP().toString();

    String response;

    serializeJson(doc, response);

    request->send(
        200,
        "application/json",
        response
    );
}

static void startAccessPoint()
{
    Serial.println("Starting setup AP");

    WiFi.mode(WIFI_AP_STA);

    WiFi.softAP(
        "DavBar Tap 1",
        "davbar123"
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
    );

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
        "/status",
        HTTP_GET,
        handleStatus
    );

    // server.on(
    //     "/image",
    //     HTTP_POST,
    //     [](AsyncWebServerRequest* request)
    //     {
    //         Serial.println("Image POST finished");

    //         request->send(
    //             200,
    //             "text/plain",
    //             "OK"
    //         );
    //     }
    // );

    server.onNotFound(
        [](AsyncWebServerRequest *request)
        {
            request->redirect("/");
        }
    );

    server.begin();

    Serial.println("HTTP server started");
}
