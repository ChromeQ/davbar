#include "Settings.h"

#include <Preferences.h>

static const char* wifiNamespace = "wifi";

bool loadWifiSettings(String& ssid, String& password)
{
    // Opened for writing so a missing namespace is created rather than logged
    // as an error before Wi-Fi is first saved.
    Preferences preferences;
    if (!preferences.begin(wifiNamespace, false))
    {
        return false;
    }

    // Checked first, because reading a missing key logs an error.
    ssid = preferences.isKey("ssid") ? preferences.getString("ssid", "") : "";
    password = preferences.isKey("password") ? preferences.getString("password", "") : "";
    preferences.end();

    return !ssid.isEmpty();
}

bool saveWifiSettings(const String& ssid, const String& password)
{
    Preferences preferences;
    if (!preferences.begin(wifiNamespace, false))
    {
        return false;
    }

    bool saved =
        preferences.putString("ssid", ssid) == ssid.length() &&
        preferences.putString("password", password) == password.length();
    preferences.end();

    return saved;
}

bool clearWifiSettings()
{
    Preferences preferences;
    if (!preferences.begin(wifiNamespace, false))
    {
        return false;
    }

    bool cleared = preferences.clear();
    preferences.end();

    return cleared;
}

static const char* laserNamespace = "laser";

bool loadLaserSettings(String& address, String& mode)
{
    Preferences preferences;
    if (!preferences.begin(laserNamespace, false))
    {
        return false;
    }

    // Checked first, because reading a missing key logs an error.
    bool chosen = preferences.isKey("address");
    if (chosen)
    {
        address = preferences.getString("address", "");
        mode = preferences.isKey("mode") ? preferences.getString("mode", "smart") : "smart";
    }
    preferences.end();

    return chosen && !address.isEmpty();
}

bool saveLaserSettings(const String& address, const String& mode)
{
    Preferences preferences;
    if (!preferences.begin(laserNamespace, false))
    {
        return false;
    }

    bool saved =
        preferences.putString("address", address) == address.length() &&
        preferences.putString("mode", mode) == mode.length();
    preferences.end();

    return saved;
}

bool clearLaserSettings()
{
    Preferences preferences;
    if (!preferences.begin(laserNamespace, false))
    {
        return false;
    }

    bool cleared = preferences.clear();
    preferences.end();

    return cleared;
}
