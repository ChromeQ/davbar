#pragma once

#include <Arduino.h>

void startWifi();

void processWifiManager();

void startWebServer();

// For the setup help, from the loop: whether the tap is on its saved Wi-Fi, whether
// its own setup network is open, and its address on the Wi-Fi.
bool wifiIsConnected();
bool setupAccessPointIsOpen();
String wifiIpAddress();
