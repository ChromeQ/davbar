import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DeviceConfig = {
  brandName: string;
  deviceName: string;
  deviceId: string;
  hostname: string;
  accessPointPassword: string;
  accessPointName: string;
  uploadHost: string;
  uploadUrl: string;
  defaultText: string;
  outputFileName: string;
  appTitle: string;
  connectTitle: string;
};

type DeviceConfigInput = Pick<
  DeviceConfig,
  "brandName" | "deviceName" | "deviceId" | "hostname" | "accessPointPassword"
>;

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repositoryDirectory = path.resolve(appDirectory, "..");
export const defaultConfigPath = path.join(
  repositoryDirectory,
  "config/default.json",
);

const requiredKeys: Array<keyof DeviceConfigInput> = [
  "brandName",
  "deviceName",
  "deviceId",
  "hostname",
  "accessPointPassword",
];

const readInput = (configPath: string): DeviceConfigInput => {
  let value: unknown;

  try {
    value = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read device config ${configPath}: ${reason}`);
  }

  if (typeof value !== "object" || value === null) {
    throw new Error(`Device config ${configPath} must contain a JSON object.`);
  }

  for (const key of requiredKeys) {
    if (
      !(key in value) ||
      typeof value[key as keyof typeof value] !== "string"
    ) {
      throw new Error(
        `Device config ${configPath} must define a string "${key}".`,
      );
    }

    if ((value[key as keyof typeof value] as string).trim().length === 0) {
      throw new Error(
        `Device config ${configPath} must define a non-empty "${key}".`,
      );
    }
  }

  const input = value as DeviceConfigInput;

  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.hostname)) {
    throw new Error(
      `Device config ${configPath} hostname must contain only lowercase letters, numbers, and internal hyphens.`,
    );
  }

  if (
    input.accessPointPassword.length < 8 ||
    input.accessPointPassword.length > 63
  ) {
    throw new Error(
      `Device config ${configPath} accessPointPassword must be 8-63 characters.`,
    );
  }

  return input;
};

export const resolveDeviceConfigPath = (
  selectedPath = process.env.DEVICE_CONFIG,
): string =>
  selectedPath
    ? path.resolve(repositoryDirectory, selectedPath)
    : defaultConfigPath;

export const loadDeviceConfig = (selectedPath = process.env.DEVICE_CONFIG) => {
  const configPath = resolveDeviceConfigPath(selectedPath);
  const input = readInput(configPath);
  const outputFileStem = input.brandName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const uploadHost = `${input.hostname}.local`;
  const config: DeviceConfig = {
    ...input,
    accessPointName: `${input.brandName} ${input.deviceName}`,
    uploadHost,
    uploadUrl: `http://${uploadHost}`,
    defaultText: input.brandName,
    outputFileName: `${outputFileStem || "display"}-text.bin`,
    appTitle: `${input.brandName} Display`,
    connectTitle: `${input.brandName} | Configure WiFi`,
  };

  return { config, configPath };
};

export const printDeviceConfig = (config: DeviceConfig, configPath: string) => {
  console.log(
    `Device config: ${path.relative(repositoryDirectory, configPath)}`,
  );
  console.log(`Brand: ${config.brandName}`);
  console.log(`Device: ${config.deviceName} (${config.deviceId})`);
  console.log(`Access point: ${config.accessPointName}`);
  console.log(`Hostname: ${config.uploadHost}`);
};
