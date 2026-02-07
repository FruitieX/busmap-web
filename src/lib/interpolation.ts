import type { TrackedVehicle } from '@/types';
import { getVehicleTiming } from '@/constants';

// Meters per degree at a given latitude
const METERS_PER_DEGREE_LAT = 111_320;
const metersPerDegreeLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Maximum correction distance in meters — beyond this the vehicle "jumped" and we snap instead of sliding. */
const MAX_CORRECTION_METERS = 500;

export interface InterpolatedPosition {
  lat: number;
  lng: number;
  heading: number;
}

/**
 * Extrapolate a vehicle position forward in time, curving the heading from
 * the velocity-derived heading toward the GPS/compass-reported heading
 * to smoothly handle turns.
 *
 * Uses an arc approximation: the midpoint heading is used for displacement
 * while the endpoint heading is returned for the arrow direction.
 */
export const extrapolate = (
  lat: number,
  lng: number,
  velocityHeading: number,
  reportedHeading: number,
  speed: number,
  speedAccel: number,
  dtSeconds: number,
): InterpolatedPosition => {
  // Integrate speed with linear acceleration, clamped at zero
  const avgSpeed = Math.max(0, speed + speedAccel * dtSeconds * 0.5);
  const distance = avgSpeed * dtSeconds;

  // Exponential heading blend: velocity → reported (handles turns)
  const headingDiff = ((reportedHeading - velocityHeading + 540) % 360) - 180;
  const blend = 1 - Math.exp(-3 * dtSeconds);
  const endHeading = velocityHeading + headingDiff * blend;

  // Use midpoint heading for displacement (arc approximation)
  const blendMid = 1 - Math.exp(-1.5 * dtSeconds);
  const midHeading = velocityHeading + headingDiff * blendMid;
  const midRad = (midHeading * Math.PI) / 180;

  const newLat = lat + (distance * Math.cos(midRad)) / METERS_PER_DEGREE_LAT;
  const newLng = lng + (distance * Math.sin(midRad)) / metersPerDegreeLng(lat);

  return { lat: newLat, lng: newLng, heading: endHeading };
};

// ---------------------------------------------------------------------------
// Per-vehicle correction state for smooth transitions when new data arrives
// ---------------------------------------------------------------------------

/** Internal state for a single vehicle's smooth correction. */
interface CorrectionState {
  /** Last interpolated position (what was displayed). */
  lastLat: number;
  lastLng: number;
  lastHeading: number;

  /** Additive correction offset. */
  offsetLat: number;
  offsetLng: number;
  offsetHeading: number;
  /** Timestamp when the correction was computed. */
  offsetTime: number;

  /** Vehicle data coordinates when the state was last synced. */
  dataLat: number;
  dataLng: number;
}

/** Module-level map: vehicleId → correction state. */
const corrections = new Map<string, CorrectionState>();

/**
 * Compute the interpolated position for a vehicle at the given timestamp.
 *
 * Combines forward extrapolation with a decaying additive correction so that
 * markers glide smoothly instead of jumping when new MQTT data arrives.
 *
 * Mutates a shared module-level Map keyed by vehicle ID (optionally scoped).
 *
 * @param scope — Optional namespace to isolate correction state. Different
 *   callers (e.g. the main render loop vs. a popover hook) should use separate
 *   scopes so they don't corrupt each other's state, especially when one caller
 *   may hold stale data (e.g. during AnimatePresence exit animations).
 */
export const interpolateVehicle = (
  vehicle: TrackedVehicle,
  now: number,
  scope?: string,
): InterpolatedPosition => {
  const timing = getVehicleTiming(vehicle.mode);
  const timeSinceUpdate = now - vehicle.lastPositionUpdate;

  // --- Resolve correction offsets ---
  const key = scope ? `${scope}:${vehicle.vehicleId}` : vehicle.vehicleId;
  const state = corrections.get(key);
  const dataChanged = state !== undefined && (state.dataLat !== vehicle.lat || state.dataLng !== vehicle.lng);

  let offsetLat = 0;
  let offsetLng = 0;
  let offsetHeading = 0;
  let offsetTime = now;

  if (dataChanged && state) {
    // New data arrived — compute correction from last displayed position to avoid a jump.
    const corrLat = state.lastLat - vehicle.lat;
    const corrLng = state.lastLng - vehicle.lng;

    // Skip correction if the position jumped too far (e.g. animation was off,
    // or vehicle teleported between trips).
    const corrLatM = corrLat * METERS_PER_DEGREE_LAT;
    const corrLngM = corrLng * metersPerDegreeLng(vehicle.lat);
    const corrDistM = Math.sqrt(corrLatM * corrLatM + corrLngM * corrLngM);

    if (corrDistM < MAX_CORRECTION_METERS) {
      offsetLat = corrLat;
      offsetLng = corrLng;
      offsetHeading = ((state.lastHeading - vehicle.heading + 540) % 360) - 180;
    }
    offsetTime = now;
  } else if (state) {
    // No new data — preserve existing correction.
    offsetLat = state.offsetLat;
    offsetLng = state.offsetLng;
    offsetHeading = state.offsetHeading;
    offsetTime = state.offsetTime;
  }

  // --- Extrapolate from the known (store) position ---
  let lat: number;
  let lng: number;
  let heading: number;

  if (timeSinceUpdate <= timing.maxExtrapolateMs && vehicle.speed >= 0.3) {
    const predicted = extrapolate(
      vehicle.lat,
      vehicle.lng,
      vehicle.heading,
      vehicle.reportedHeading ?? vehicle.heading,
      vehicle.speed,
      vehicle.speedAcceleration ?? vehicle.acceleration ?? 0,
      timeSinceUpdate / 1000,
    );
    lat = predicted.lat;
    lng = predicted.lng;
    heading = predicted.heading;
  } else {
    lat = vehicle.lat;
    lng = vehicle.lng;
    heading = vehicle.heading;
  }

  // --- Apply decaying correction ---
  const correctionAge = now - offsetTime;
  const decay =
    correctionAge < timing.correctionMs
      ? Math.exp((-4 * correctionAge) / timing.correctionMs)
      : 0;

  lat += offsetLat * decay;
  lng += offsetLng * decay;
  heading += offsetHeading * decay;

  // --- Persist state ---
  corrections.set(key, {
    lastLat: lat,
    lastLng: lng,
    lastHeading: heading,
    offsetLat,
    offsetLng,
    offsetHeading,
    offsetTime,
    dataLat: vehicle.lat,
    dataLng: vehicle.lng,
  });

  return { lat, lng, heading };
};

/**
 * Remove correction states for vehicles that are no longer tracked.
 * Call periodically (e.g. every few seconds) to avoid unbounded memory growth.
 */
export const pruneInterpolationStates = (activeIds: Set<string>): void => {
  for (const key of corrections.keys()) {
    // Scoped keys use "scope:vehicleId" format; extract the vehicleId part.
    const separatorIdx = key.indexOf(':');
    const vehicleId = separatorIdx >= 0 ? key.slice(separatorIdx + 1) : key;
    if (!activeIds.has(vehicleId)) {
      corrections.delete(key);
    }
  }
};
