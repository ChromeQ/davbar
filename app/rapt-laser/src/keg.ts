/** The laser distances for an empty and a full keg. */
export type KegCalibration = {
  capacityLitres: number;
  /** Laser distance when the keg is empty, in mm. */
  emptyDistanceMm: number;
  /** Laser distance when the keg is full, in mm. */
  fullDistanceMm: number;
};

/**
 * A 19 L corny keg with the RAPT lid kit. Matches every RAPT app reading so
 * far. Check against a real keg at the next keg change.
 */
export const CORNY_KEG_19L: KegCalibration = {
  capacityLitres: 19,
  emptyDistanceMm: 552,
  fullDistanceMm: 22,
};

export type KegLevel = {
  /** Rounded down to 0.1 L, like the RAPT app. */
  litres: number;
  /** Rounded down to a whole percent. */
  percent: number;
};

/**
 * Converts a laser distance to what is left in the keg, treating the keg as a
 * straight-sided cylinder. Uses whole numbers (tenths of a litre and mm) so
 * rounding down is exact, and the C++ version can match it.
 */
export function kegLevel(
  distanceMm: number,
  keg: KegCalibration = CORNY_KEG_19L,
): KegLevel {
  const range = keg.emptyDistanceMm - keg.fullDistanceMm;

  if (range <= 0) {
    throw new Error("The empty distance must be greater than the full distance");
  }

  const depth = Math.min(Math.max(keg.emptyDistanceMm - distanceMm, 0), range);
  const capacityTenths = Math.round(keg.capacityLitres * 10);

  return {
    litres: Math.floor((capacityTenths * depth) / range) / 10,
    percent: Math.floor((100 * depth) / range),
  };
}
