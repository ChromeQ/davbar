import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  loadDeviceConfig,
  printDeviceConfig,
  repositoryDirectory,
  resolveDeviceConfigPath,
} from "./device-config.ts";

const argumentsList = process.argv.slice(2);
const command = argumentsList[0];
const configFlagIndex = argumentsList.indexOf("--config");

if (command !== "build" && command !== "upload" && command !== "upload-fs") {
  throw new Error(
    "Usage: pnpm device:build|device:upload|device:upload:fs --config config/profile.json",
  );
}

if (configFlagIndex >= 0 && !argumentsList[configFlagIndex + 1]) {
  throw new Error("--config requires a JSON file path.");
}

const selectedPath =
  configFlagIndex >= 0
    ? argumentsList[configFlagIndex + 1]
    : process.env.DEVICE_CONFIG;
const configPath = resolveDeviceConfigPath(selectedPath);
const { config } = loadDeviceConfig(configPath);
const environment = { ...process.env, DEVICE_CONFIG: configPath };
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
  run(
    platformio,
    ["run", "-d", esp32Directory, "--target", "uploadfs"],
    repositoryDirectory,
  );
}
