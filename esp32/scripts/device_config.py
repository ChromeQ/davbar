Import("env")

import hashlib
import json
import os
import re
from pathlib import Path

repository_directory = Path(env["PROJECT_DIR"]).parent


def read_json(path, description):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Unable to read {description} {path}: {error}") from error


# The device commands in ../app always choose a profile. Raw PlatformIO builds,
# including the IDE's, fall back to the example so they still compile.
selected_path = os.environ.get("DEVICE_CONFIG")
if not selected_path:
    selected_path = "config/example.json"
    print("No DEVICE_CONFIG set, so building with config/example.json")

config_path = Path(selected_path)
if not config_path.is_absolute():
    config_path = repository_directory / config_path

config = read_json(config_path, "device config")

required_keys = (
    "brandName",
    "deviceName",
    "deviceId",
    "hostname",
)
for key in required_keys:
    if not isinstance(config.get(key), str) or not config[key].strip():
        raise RuntimeError(f'Device config {config_path} must define a non-empty string "{key}".')

access_point_name = f'{config["brandName"]} {config["deviceName"]}'
if len(access_point_name.encode("utf-8")) > 32:
    raise RuntimeError("Derived access point name must not exceed 32 UTF-8 bytes.")

mdns_hostname = f'{config["hostname"]}-{config["deviceId"]}'

# Passwords live in a git-ignored file, shared by every tap, so they stay out of
# the repository and the web app.
secrets_path = repository_directory / "config/secrets.json"
example_secrets_path = repository_directory / "config/secrets.example.json"
if not secrets_path.exists():
    raise RuntimeError(
        f"Missing {secrets_path}. Copy config/secrets.example.json to "
        "config/secrets.json and set both passwords."
    )

secrets = read_json(secrets_path, "secrets")
example_secrets = read_json(example_secrets_path, "example secrets")

for key in ("accessPointPassword", "otaPassword"):
    if not isinstance(secrets.get(key), str) or not secrets[key]:
        raise RuntimeError(f'{secrets_path} must define a non-empty string "{key}".')
    if secrets[key] == example_secrets.get(key):
        raise RuntimeError(f'{secrets_path} still has the example "{key}". Choose a password.')

if not 8 <= len(secrets["accessPointPassword"]) <= 63:
    raise RuntimeError("accessPointPassword must be 8-63 characters.")

# The firmware only needs the hash to check the password espota sends.
ota_password_hash = hashlib.md5(secrets["otaPassword"].encode("utf-8")).hexdigest()

# The lasers, numbered like the dots on their lids, are shared by every tap.
lasers_path = repository_directory / "config/lasers.json"
lasers = read_json(lasers_path, "laser list")
address_pattern = re.compile(r"^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")

if not isinstance(lasers, list) or not lasers:
    raise RuntimeError(f"{lasers_path} must be a non-empty list of lasers.")

for laser in lasers:
    number = laser.get("number") if isinstance(laser, dict) else None
    address = laser.get("address") if isinstance(laser, dict) else None
    if not isinstance(number, int) or not 1 <= number <= 9:
        raise RuntimeError(f"{lasers_path}: each laser needs a number from 1 to 9.")
    if not isinstance(address, str) or not address_pattern.match(address):
        raise RuntimeError(
            f'{lasers_path}: laser {number} needs an address like "E5:4C:66:F9:E1:33" '
            "(capital letters)."
        )

for key in ("number", "address"):
    values = [laser[key] for laser in lasers]
    if len(set(values)) != len(values):
        raise RuntimeError(f"{lasers_path}: two lasers have the same {key}.")

laser_lines = "".join(
    f'        {{{laser["number"]}, {json.dumps(laser["address"])}}},\n'
    for laser in sorted(lasers, key=lambda laser: laser["number"])
)

generated_directory = Path(env.subst("$BUILD_DIR")) / "generated"
generated_directory.mkdir(parents=True, exist_ok=True)
header_path = generated_directory / "DeviceConfig.h"
header_path.write_text(
    "#pragma once\n\n"
    "#include <stdint.h>\n\n"
    "namespace DeviceConfig\n"
    "{\n"
    f'    constexpr char BrandName[] = {json.dumps(config["brandName"])};\n'
    f'    constexpr char DeviceName[] = {json.dumps(config["deviceName"])};\n'
    f'    constexpr char DeviceId[] = {json.dumps(config["deviceId"])};\n'
    f'    constexpr char Hostname[] = {json.dumps(config["hostname"])};\n'
    f'    constexpr char MdnsHostname[] = {json.dumps(mdns_hostname)};\n'
    f'    constexpr char AccessPointName[] = {json.dumps(access_point_name)};\n'
    f'    constexpr char AccessPointPassword[] = {json.dumps(secrets["accessPointPassword"])};\n'
    f'    constexpr char OtaPasswordHash[] = {json.dumps(ota_password_hash)};\n'
    "\n"
    "    struct Laser\n"
    "    {\n"
    "        uint8_t number;\n"
    "        const char* address;\n"
    "    };\n"
    "\n"
    "    // From config/lasers.json, in number order\n"
    "    constexpr Laser Lasers[] = {\n"
    f"{laser_lines}"
    "    };\n"
    "}\n",
    encoding="utf-8",
)

env.Append(CPPPATH=[str(generated_directory)])

# pnpm device:upload --ota sets DEVICE_OTA, which uploads over Wi-Fi to the
# profile's address instead of USB.
if os.environ.get("DEVICE_OTA") == "1":
    env.Replace(
        UPLOAD_PROTOCOL="espota",
        UPLOAD_PORT=f"{mdns_hostname}.local",
        UPLOAD_FLAGS=[f'--auth={secrets["otaPassword"]}'],
    )

try:
    shown_path = config_path.relative_to(repository_directory)
except ValueError:
    shown_path = config_path

print(f"Device config: {shown_path}")
print(f'Brand: {config["brandName"]}')
print(f'Device: {config["deviceName"]} ({config["deviceId"]})')
print(f"Access point: {access_point_name}")
print(f"Hostname: {mdns_hostname}.local")
if os.environ.get("DEVICE_OTA") == "1":
    print(f"Upload: over Wi-Fi to {mdns_hostname}.local")
