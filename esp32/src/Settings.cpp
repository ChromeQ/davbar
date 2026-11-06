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

    ssid = preferences.getString("ssid", "");
    password = preferences.getString("password", "");
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
