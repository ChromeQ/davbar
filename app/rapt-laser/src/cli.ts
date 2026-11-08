#!/usr/bin/env node

import {
  decodeLaserAdvertisement,
  decodeLaserManufacturerData,
  decodeLaserPayload,
  hexToBytes,
  kegLevel,
  LASER_MODE_NAMES,
} from './index.js';

function main() {
  const hex = process.argv.slice(2).join('');

  if (!hex) {
    console.error(
      'Usage: rapt-laser <hex>\n' +
        'The hex can be the payload, the manufacturer data or the whole ' +
        'advertisement, as copied from nRF Connect.'
    );
    process.exit(1);
  }

  const bytes = hexToBytes(hex);
  const reading =
    decodeLaserPayload(bytes) ??
    decodeLaserManufacturerData(bytes) ??
    decodeLaserAdvertisement(bytes);

  if (!reading) {
    console.error('Not a RAPT Laser Level Sensor advertisement');
    process.exit(1);
  }

  let distance = 'no reading';

  if (reading.distanceMm !== null) {
    const level = kegLevel(reading.distanceMm);
    distance = `${reading.distanceMm} mm (${level.litres.toFixed(1)} L, ${level.percent}%)`;
  }

  console.log(`Address      ${reading.address}`);
  console.log(`Mode         ${reading.mode ? LASER_MODE_NAMES[reading.mode] : 'unknown'}`);
  console.log(`Distance     ${distance}`);
  console.log(
    `Battery      ${reading.batteryPercent === null ? 'missing' : `${reading.batteryPercent.toFixed(1)}%`}`
  );
  console.log(
    `Temperature  ${reading.temperatureC === null ? 'missing' : `${reading.temperatureC.toFixed(2)} °C`}`
  );
}

main();
