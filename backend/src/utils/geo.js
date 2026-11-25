/**
 * Geo analytics for consumer scans (off-chain, item 10).
 *
 * Detectors are pure functions so they can be unit-tested without a database or chain.
 */

// Thresholds (see docs): commercial jets cruise ~900 km/h, so anything faster between two scans of
// the same physical pack means two packs carry the same label. Coarse locations (city centre /
// browser geolocation) can be off by tens of km, hence the distance floors.
const IMPOSSIBLE_SPEED_KMH = 900;
const IMPOSSIBLE_MIN_DISTANCE_KM = 50;
const REGION_RADIUS_KM = 100;
const REGION_WINDOW_HOURS = 72;

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const hasLoc = (x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lon);

/**
 * @param {{lat,lon,at:Date,city}} scan            the new scan
 * @param {Array<{lat,lon,at:Date,city}>} previous earlier scans of the same unit
 * @returns {null | {distanceKm, hours, speedKmh, other}}
 */
function detectImpossibleTravel(scan, previous) {
  if (!hasLoc(scan)) return null;
  let worst = null;
  for (const p of previous) {
    if (!hasLoc(p)) continue;
    const distanceKm = haversineKm(scan, p);
    if (distanceKm <= IMPOSSIBLE_MIN_DISTANCE_KM) continue;
    const hours = Math.max(Math.abs(new Date(scan.at) - new Date(p.at)) / 3.6e6, 1 / 60); // >= 1 min
    const speedKmh = distanceKm / hours;
    if (speedKmh > IMPOSSIBLE_SPEED_KMH && (!worst || speedKmh > worst.speedKmh)) {
      worst = { distanceKm, hours, speedKmh, other: p };
    }
  }
  return worst;
}

/**
 * @param {{lat,lon,at:Date}} scan
 * @param {{dispensedAt?:Date, dispenser?:{lat,lon,city,name}, holder?:{lat,lon,city,name}}} ctx
 * @returns {null | {mode:"dispensed"|"undispensed", distanceKm, reference}}
 */
function detectOutOfRegion(scan, ctx) {
  if (!hasLoc(scan)) return null;
  if (ctx.dispensedAt && hasLoc(ctx.dispenser)) {
    const hours = (new Date(scan.at) - new Date(ctx.dispensedAt)) / 3.6e6;
    if (hours >= 0 && hours <= REGION_WINDOW_HOURS) {
      const distanceKm = haversineKm(scan, ctx.dispenser);
      if (distanceKm > REGION_RADIUS_KM) return { mode: "dispensed", distanceKm, hours, reference: ctx.dispenser };
    }
    return null;
  }
  if (!ctx.dispensedAt && hasLoc(ctx.holder)) {
    const distanceKm = haversineKm(scan, ctx.holder);
    if (distanceKm > REGION_RADIUS_KM) return { mode: "undispensed", distanceKm, reference: ctx.holder };
  }
  return null;
}

module.exports = {
  haversineKm,
  detectImpossibleTravel,
  detectOutOfRegion,
  IMPOSSIBLE_SPEED_KMH,
  IMPOSSIBLE_MIN_DISTANCE_KM,
  REGION_RADIUS_KM,
  REGION_WINDOW_HOURS
};
