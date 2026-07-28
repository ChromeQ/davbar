Import("env")

import json
import os
from pathlib import Path

repository_directory = Path(env["PROJECT_DIR"]).parent
selected_path = os.environ.get("DEVICE_CONFIG", "config/default.json")
config_path = Path(selected_path)
if not config_path.is_absolute():
    config_path = repository_directory / config_path

try:
    config = json.loads(config_path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as error:
    raise RuntimeError(f"Unable to read device config {config_path}: {error}") from error

required_keys = (
    "brandName",
    "deviceName",
    "deviceId",
    "hostname",
    "accessPointPassword",
)
for key in required_keys:
    if not isinstance(config.get(key), str) or not config[key].strip():
        raise RuntimeError(f'Device config {config_path} must define a non-empty string "{key}".')

access_point_name = f'{config["brandName"]} {config["deviceName"]}'
if len(access_point_name.encode("utf-8")) > 32:
    raise RuntimeError("Derived access point name must not exceed 32 UTF-8 bytes.")

if not 8 <= len(config["accessPointPassword"]) <= 63:
    raise RuntimeError("accessPointPassword must be 8-63 characters.")

generated_directory = Path(env.subst("$BUILD_DIR")) / "generated"
generated_directory.mkdir(parents=True, exist_ok=True)
header_path = generated_directory / "DeviceConfig.h"
header_path.write_text(
    "#pragma once\n\n"
    "namespace DeviceConfig\n"
    "{\n"
    f'    constexpr char BrandName[] = {json.dumps(config["brandName"])};\n'
    f'    constexpr char DeviceName[] = {json.dumps(config["deviceName"])};\n'
    f'    constexpr char DeviceId[] = {json.dumps(config["deviceId"])};\n'
    f'    constexpr char Hostname[] = {json.dumps(config["hostname"])};\n'
    f'    constexpr char AccessPointName[] = {json.dumps(access_point_name)};\n'
    f'    constexpr char AccessPointPassword[] = {json.dumps(config["accessPointPassword"])};\n'
    "}\n",
    encoding="utf-8",
)

env.Append(CPPPATH=[str(generated_directory)])

print(f"Device config: {config_path.relative_to(repository_directory)}")
print(f'Brand: {config["brandName"]}')
print(f'Device: {config["deviceName"]} ({config["deviceId"]})')
print(f"Access point: {access_point_name}")
print(f'Hostname: {config["hostname"]}.local')
