/** What the laser read with that much in the keg. */
export type KegPoint = {
  distanceMm: number;
  litres: number;
};

/**
 * A keg's points from empty to full: the distances going down and the litres
 * going up. Between two points the keg is taken to fill evenly, so the litres
 * are on the straight line between them.
 */
export type KegCalibration = readonly KegPoint[];

/**
 * How much closer the laser reads with the float's ball under it: it sees the
 * top of the ball instead of the beer (533 mm without it, 508 mm with it, in
 * the same filling on 2026-11-16).
 */
const BALL_ABOVE_BEER_MM = 25;

/**
 * A 19 L Corny keg with the RAPT lid kit and a floating dip tube, filled from a
 * jug on 2026-11-16 (docs/rapt-laser-sensor.md, "Calibration"):
 * - The domed bottom, up to 3 L, is every point measured, 0.5 L apart, from a
 *   second filling with the float tied up out of the beam, then moved
 *   BALL_ABOVE_BEER_MM closer. Down there the float's ball tends to sit under
 *   the laser, which then reads the top of the ball instead of the beer. So
 *   with the ball in the beam the bottom shows what's there, and with it out
 *   of the way up to about 1 L less: never more.
 * - Above it the keg is a straight cylinder: one line, 27.2 mm a litre, fitted
 *   to the readings from 5 L to 18.5 L, where the float hangs clear. From 3 L
 *   to 5 L it joins the bottom to the line.
 * - The laser reads short this close, so 29 mm or nearer is full.
 *
 * Keep it the same as RaptLaser::Corny19L in the firmware.
 */
export const CORNY_KEG_19L: KegCalibration = [
  { distanceMm: 564 - BALL_ABOVE_BEER_MM, litres: 0 },
  { distanceMm: 557 - BALL_ABOVE_BEER_MM, litres: 0.5 },
  { distanceMm: 533 - BALL_ABOVE_BEER_MM, litres: 1 },
  { distanceMm: 519 - BALL_ABOVE_BEER_MM, litres: 1.5 },
  { distanceMm: 502 - BALL_ABOVE_BEER_MM, litres: 2 },
  { distanceMm: 482 - BALL_ABOVE_BEER_MM, litres: 2.5 },
  { distanceMm: 465 - BALL_ABOVE_BEER_MM, litres: 3 },
  { distanceMm: 399, litres: 5 },
  { distanceMm: 45, litres: 18 },
  { distanceMm: 29, litres: 19 },
];

export type KegLevel = {
  /** Rounded down to 0.1 L. */
  litres: number;
  /** Of a full keg's litres, rounded down to a whole percent. */
  percent: number;
};

/**
 * Converts a laser distance to what is left in the keg. Beyond the first point
 * the keg is empty, and nearer than the last it is full. Uses whole numbers
 * (tenths of a litre and mm) so rounding down is exact, and the C++ version can
 * match it.
 */
export function kegLevel(distanceMm: number, keg: KegCalibration = CORNY_KEG_19L): KegLevel {
  const points = keg.map((point) => ({
    distanceMm: point.distanceMm,
    tenths: Math.round(point.litres * 10),
  }));

  const empty = points[0];
  const full = points[points.length - 1];
  const inOrder = points.every((point, i) => {
    const previous = points[i - 1];

    return !previous || (point.distanceMm < previous.distanceMm && point.tenths > previous.tenths);
  });

  if (!empty || !full || points.length < 2 || !inOrder) {
    throw new Error(
      'The keg needs 2 points or more, from empty to full: distances going down, litres going up'
    );
  }

  const distance = Math.min(Math.max(distanceMm, full.distanceMm), empty.distanceMm);

  // The two points either side: far, then the next one nearer.
  let far = empty;
  let near = full;

  for (const point of points.slice(1)) {
    near = point;

    if (point.distanceMm <= distance) {
      break;
    }

    far = point;
  }

  // The litres times the gap between the points, so it stays a whole number
  // until the end.
  const gap = far.distanceMm - near.distanceMm;
  const risen = far.distanceMm - distance;
  const scaled = far.tenths * gap + (near.tenths - far.tenths) * risen;

  return {
    litres: Math.floor(scaled / gap) / 10,
    percent: Math.floor((100 * scaled) / (gap * full.tenths)),
  };
}
