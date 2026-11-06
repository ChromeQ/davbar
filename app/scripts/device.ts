import { spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  loadDeviceConfig,
  printDeviceConfig,
  repositoryDirectory,
  resolveDeviceConfigPath,
} from "./device-config.ts";

const usage =
  "Usage: pnpm device:build|device:upload|device:upload:fs --config config/tap-1.json [--ota]";

const argumentsList = process.argv.slice(2);
const command = argumentsList[0];
const configFlagIndex = argumentsList.indexOf("--config");
const overTheAir = argumentsList.includes("--ota");

if (command !== "build" && command !== "upload" && command !== "upload-fs") {
  throw new Error(usage);
}

if (configFlagIndex >= 0 && !argumentsList[configFlagIndex + 1]) {
  throw new Error("--config requires a JSON file path.");
}

if (overTheAir && command === "build") {
  throw new Error("--ota only applies to device:upload and device:upload:fs.");
}

const selectedPath =
  configFlagIndex >= 0
    ? argumentsList[configFlagIndex + 1]
    : process.env.DEVICE_CONFIG;

// Each profile is a different tap, so never guess which one to build or upload.
if (!selectedPath) {
  throw new Error(
    `Choose a tap profile, for example --config config/tap-1.json.\n${usage}`,
  );
}

const configPath = resolveDeviceConfigPath(selectedPath);
const { config } = loadDeviceConfig(configPath);
const environment = {
  ...process.env,
  DEVICE_CONFIG: configPath,
  ...(overTheAir ? { DEVICE_OTA: "1" } : {}),
};
const platformio = path.join(
  process.env.HOME ?? "",
  ".platformio/penv/bin/platformio",
);

printDeviceConfig(config, configPath);

const run = (executable: string, args: string[], cwd: string) => {
  const result = spawnSync(executable, args, {
    cwd,
    env: environment,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

// After an over-the-air firmware update the device restarts and rejoins Wi-Fi,
// which can take up to a minute, before it can take the filesystem upload.
const waitForDevice = async () => {
  console.log(`Waiting for ${config.uploadHost} to restart...`);

  // Give it time to go down first, so the old firmware doesn't answer.
  await delay(5000);

  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${config.uploadUrl}/status`, {
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        console.log(`${config.uploadHost} is back`);
        return;
      }
    } catch {
      // Not back yet
    }

    await delay(2000);
  }

  throw new Error(`${config.uploadHost} didn't come back within 2 minutes.`);
};

const appDirectory = path.join(repositoryDirectory, "app");
const webDirectory = path.join(appDirectory, "web");
const esp32Directory = path.join(repositoryDirectory, "esp32");

run("pnpm", ["--dir", webDirectory, "build"], appDirectory);
run(
  "rsync",
  [
    "-a",
    "--delete",
    "--exclude=.gitignore",
    "dist/",
    `${esp32Directory}/data/`,
  ],
  webDirectory,
);

if (command === "upload-fs") {
  run(
    platformio,
    ["run", "-d", esp32Directory, "--target", "uploadfs"],
    repositoryDirectory,
  );
} else {
  run(platformio, ["run", "-d", esp32Directory], repositoryDirectory);
}

if (command === "upload") {
  run(
    platformio,
    ["run", "-d", esp32Directory, "--target", "upload"],
    repositoryDirectory,
  );

  if (overTheAir) {
    await waitForDevice();
  }

  run(
    platformio,
    ["run", "-d", esp32Directory, "--target", "uploadfs"],
    repositoryDirectory,
  );
}
