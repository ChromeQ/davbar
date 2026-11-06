import { describe, expect, it } from "vitest";
import {
  decodeLaserAdvertisement,
  decodeLaserManufacturerData,
  decodeLaserPayload,
  hexToBytes,
  type LaserReading,
} from "../src/index.js";

const ADDRESS = "E5:4C:66:F9:E1:33";

// Real payloads from laser 1, captured with nRF Connect and the laptop logger.
const CAPTURES: [string, string, Omit<LaserReading, "address">][] = [
  [
    "19 mm, Live Stream",
    "5054A1E54C66F9E13313001D020AE803B70703",
    {
      distanceMm: 19,
      batteryPercent: 100,
      temperatureC: 19.75,
      mode: "liveStream",
    },
  ],
  [
    "no reading",
    "5054A1E54C66F9E1330000000000FFFF008001",
    {
      distanceMm: null,
      batteryPercent: null,
      temperatureC: null,
      mode: "smart",
    },
  ],
  [
    "133 mm, Smart",
    "5054A1E54C66F9E1338500AB010AE8031B0801",
    {
      distanceMm: 133,
      batteryPercent: 100,
      temperatureC: 20.75,
      mode: "smart",
    },
  ],
  [
    "368 mm, old batteries",
    "5054A1E54C66F9E1337001C0000A5103850701",
    {
      distanceMm: 368,
      batteryPercent: 84.9,
      temperatureC: 19.25,
      mode: "smart",
    },
  ],
  [
    "193 mm, Session",
    "5054A1E54C66F9E133C1006F010A5703210702",
    {
      distanceMm: 193,
      batteryPercent: 85.5,
      temperatureC: 18.25,
      mode: "session",
    },
  ],
  [
    "233 mm, Live Stream with the battery sagging",
    "5054A1E54C66F9E133E90047010AFF02530703",
    {
      distanceMm: 233,
      batteryPercent: 76.7,
      temperatureC: 18.75,
      mode: "liveStream",
    },
  ],
  [
    "219 mm, Ultra Low Power",
    "5054A1E54C66F9E133DB0055010A5B039E0704",
    {
      distanceMm: 219,
      batteryPercent: 85.9,
      temperatureC: 19.5,
      mode: "ultraLowPower",
    },
  ],
];

const PAYLOAD_133 = "5054A1E54C66F9E1338500AB010AE8031B0801";

describe("decodeLaserPayload", () => {
  it.each(CAPTURES)("decodes %s", (_, hex, expected) => {
    expect(decodeLaserPayload(hexToBytes(hex))).toEqual({
      address: ADDRESS,
      ...expected,
    });
  });

  it("decodes a temperature below zero", () => {
    // 0xFF06 is -250 as a signed value
    const payload = hexToBytes(PAYLOAD_133.replace("1B08", "06FF"));

    expect(decodeLaserPayload(payload)?.temperatureC).toBe(-2.5);
  });

  it("gives no mode for a mode value not seen before", () => {
    const payload = hexToBytes(PAYLOAD_133.replace(/01$/, "09"));

    expect(decodeLaserPayload(payload)?.mode).toBeNull();
  });

  it("rejects a payload of the wrong length", () => {
    expect(decodeLaserPayload(hexToBytes(PAYLOAD_133.slice(0, -2)))).toBeNull();
    expect(decodeLaserPayload(hexToBytes(`${PAYLOAD_133}00`))).toBeNull();
  });

  it("rejects a different signature", () => {
    expect(
      decodeLaserPayload(hexToBytes(PAYLOAD_133.replace(/^5054/, "5055"))),
    ).toBeNull();
  });

  it("rejects another RAPT device type", () => {
    expect(
      decodeLaserPayload(hexToBytes(PAYLOAD_133.replace(/^5054A1/, "505402"))),
    ).toBeNull();
  });
});

describe("decodeLaserManufacturerData", () => {
  it("decodes the company ID followed by the payload", () => {
    const reading = decodeLaserManufacturerData(
      hexToBytes(`5241${PAYLOAD_133}`),
    );

    expect(reading?.distanceMm).toBe(133);
  });

  it("rejects another company ID", () => {
    expect(
      decodeLaserManufacturerData(hexToBytes(`4C00${PAYLOAD_133}`)),
    ).toBeNull();
  });

  it("rejects data too short for a company ID", () => {
    expect(decodeLaserManufacturerData(hexToBytes("52"))).toBeNull();
  });
});

describe("decodeLaserAdvertisement", () => {
  // The whole advertisement for the 133 mm capture: flags, the RAPT service
  // UUID, then the manufacturer data.
  const ADVERTISEMENT =
    "0x020106110700008418B0F2BF081592060A5450415216FF5241" + PAYLOAD_133;

  it("finds and decodes the manufacturer data", () => {
    expect(decodeLaserAdvertisement(hexToBytes(ADVERTISEMENT))).toEqual(
      decodeLaserPayload(hexToBytes(PAYLOAD_133)),
    );
  });

  it("skips another company's manufacturer data", () => {
    // Apple's company ID (0x004C) in a manufacturer data section before RAPT's
    const advertisement = `0x02010604FF4C0001${ADVERTISEMENT.slice(8)}`;

    expect(
      decodeLaserAdvertisement(hexToBytes(advertisement))?.distanceMm,
    ).toBe(133);
  });

  it("gives nothing for an advertisement without manufacturer data", () => {
    expect(decodeLaserAdvertisement(hexToBytes("020106"))).toBeNull();
  });

  it("rejects manufacturer data cut short", () => {
    expect(decodeLaserAdvertisement(hexToBytes("02010616FF5241"))).toBeNull();
  });
});

describe("hexToBytes", () => {
  it("accepts a 0x prefix, lower case and separators", () => {
    expect([...hexToBytes("0x50 54-a1:e5")]).toEqual([0x50, 0x54, 0xa1, 0xe5]);
  });

  it("rejects an odd number of digits", () => {
    expect(() => hexToBytes("505")).toThrow("Invalid hex");
  });

  it("rejects characters that aren't hex", () => {
    expect(() => hexToBytes("50zz")).toThrow("Invalid hex");
  });
});
