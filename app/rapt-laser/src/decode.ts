/** Bluetooth company ID at the start of RAPT manufacturer data ("RA"). */
export const RAPT_COMPANY_ID = 0x4152;

const PAYLOAD_LENGTH = 19;
// "PT", then 0xA1, the only value seen from the lasers. Other RAPT devices,
// such as the Pill, share the company ID, so anything else is rejected rather
// than misread as a laser.
const SIGNATURE = [0x50, 0x54, 0xa1];
const NO_DISTANCE = 0;
const NO_BATTERY = 0xffff;
const NO_TEMPERATURE = -0x8000; // 0x8000 read as a signed value

// Advertisement section type for manufacturer data.
const MANUFACTURER_DATA = 0xff;

export type LaserMode = "smart" | "session" | "liveStream" | "ultraLowPower";

const MODES: Record<number, LaserMode> = {
  1: "smart",
  2: "session",
  3: "liveStream",
  4: "ultraLowPower",
};

export const LASER_MODE_NAMES: Record<LaserMode, string> = {
  smart: "Smart",
  session: "Session",
  liveStream: "Live Stream",
  ultraLowPower: "Ultra Low Power",
};

export type LaserReading = {
  /** The sensor's Bluetooth address, for example "E5:4C:66:F9:E1:33". */
  address: string;
  /** Laser to liquid, in mm. Null when the advertisement has no reading. */
  distanceMm: number | null;
  /** Battery percentage to 0.1%, or null when missing. */
  batteryPercent: number | null;
  /** Temperature in °C, or null when missing. */
  temperatureC: number | null;
  /** Null for a mode value not seen before. */
  mode: LaserMode | null;
};

/**
 * Decodes the 19-byte payload that follows the company ID in a RAPT Laser Level
 * Sensor's manufacturer data. Returns null for anything that isn't a laser
 * payload.
 */
export function decodeLaserPayload(payload: Uint8Array): LaserReading | null {
  if (
    payload.length !== PAYLOAD_LENGTH ||
    SIGNATURE.some((byte, index) => payload[index] !== byte)
  ) {
    return null;
  }

  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const distance = view.getUint16(9, true);
  const battery = view.getUint16(14, true);
  const temperature = view.getInt16(16, true);

  return {
    address: formatAddress(payload.subarray(3, 9)),
    distanceMm: distance === NO_DISTANCE ? null : distance,
    batteryPercent: battery === NO_BATTERY ? null : battery / 10,
    temperatureC: temperature === NO_TEMPERATURE ? null : temperature / 100,
    mode: MODES[view.getUint8(18)] ?? null,
  };
}

/**
 * Decodes manufacturer data as Bluetooth libraries report it: the company ID
 * (2 bytes, little-endian), then the payload.
 */
export function decodeLaserManufacturerData(
  data: Uint8Array,
): LaserReading | null {
  if (data.length < 2 || (data[0]! | (data[1]! << 8)) !== RAPT_COMPANY_ID) {
    return null;
  }

  return decodeLaserPayload(data.subarray(2));
}

/**
 * Decodes a whole raw advertisement, as nRF Connect shows it. An advertisement
 * is a list of sections, each a length byte, a type byte and data.
 */
export function decodeLaserAdvertisement(
  advertisement: Uint8Array,
): LaserReading | null {
  let offset = 0;

  while (offset < advertisement.length) {
    const length = advertisement[offset]!;

    if (length === 0) {
      break;
    }

    if (advertisement[offset + 1] === MANUFACTURER_DATA) {
      const reading = decodeLaserManufacturerData(
        advertisement.subarray(offset + 2, offset + 1 + length),
      );

      if (reading) {
        return reading;
      }
    }

    offset += 1 + length;
  }

  return null;
}

/**
 * Parses hex as copied from Bluetooth tools, such as "0x5054A1..." or
 * "50-54-a1". Spaces, colons and dashes are ignored.
 */
export function hexToBytes(hex: string): Uint8Array {
  const digits = hex.trim().replace(/^0x/i, "").replace(/[\s:-]/g, "");

  if (digits.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(digits)) {
    throw new Error(`Invalid hex: ${hex}`);
  }

  return Uint8Array.from(digits.match(/../g) ?? [], (pair) =>
    parseInt(pair, 16),
  );
}

function formatAddress(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(":");
}
