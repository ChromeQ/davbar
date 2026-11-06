export type DeviceConfig = {
  brandName: string;
  deviceName: string;
  deviceId: string;
  hostname: string;
  accessPointName: string;
  uploadHost: string;
  uploadUrl: string;
  defaultText: string;
  outputFileName: string;
  appTitle: string;
  connectTitle: string;
};

declare const __DEVICE_CONFIG__: DeviceConfig;

export const deviceConfig: DeviceConfig = __DEVICE_CONFIG__;
