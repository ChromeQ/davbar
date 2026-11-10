// A tap the tap switcher links to.
export type TapLink = {
  deviceName: string;
  deviceId: string;
  url: string;
};

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
  // Every tap with a profile next to this one, this tap included.
  taps: TapLink[];
};

declare const __DEVICE_CONFIG__: DeviceConfig;

export const deviceConfig: DeviceConfig = __DEVICE_CONFIG__;
