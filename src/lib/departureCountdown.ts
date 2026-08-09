import type { TrackedVehicle, StopDeparture } from '@/types';
import { haversineDistance } from '@/lib/utils';

/** Maximum distance (meters) to consider a vehicle "matching" a departure by proximity alone. */
const PROXIMITY_MATCH_RADIUS = 2000;

/** Maximum ETA we'll show (minutes). Beyond this, we don't have enough data. */
const MAX_ETA_MINUTES = 30;

/** Minimum vehicle freshness (ms) for a reliable ETA. */
const MAX_VEHICLE_AGE_MS = 60_000;

export interface DepartureCountdown {
  /** The matched vehicle, or null if no vehicle found. */
  vehicle: TrackedVehicle | null;
  /** Estimated minutes until the departure arrives at the stop (null if unknown). */
  etaMinutes: number | null;
  /** Distance from the vehicle to the stop in meters (null if unknown). */
  distanceMeters: number | null;
  /** Whether the ETA is based on GPS data vs schedule alone. */
  isPredicted: boolean;
}

/**
 * Match a vehicle to a departure by comparing route ID, direction, and timing.
 *
 * The matching logic:
 * 1. Find vehicles on the same route heading in the same direction
 * 2. Prefer vehicles whose startTime matches the departure's tripStartTime
 * 3. Among candidates, prefer the one whose last position update is most recent
 * 4. If no timing match, use proximity to the stop as a fallback
 */
export function findMatchingVehicle(
  vehicle: TrackedVehicle,
  departure: StopDeparture,
  stopLat: number,
  stopLon: number,
): boolean {
  // Extract route IDs for comparison
  const vehicleRouteId = vehicle.routeId.replace('HSL:', '');
  const departureRouteId = departure.routeGtfsId.replace('HSL:', '');

  // Route must match
  if (vehicleRouteId !== departureRouteId) return false;

  // Direction must match (GTFS direction 0/1 → MQTT direction 1/2)
  const mqttDir = (departure.directionId + 1) as 1 | 2;
  if (vehicle.direction !== mqttDir) return false;

  // Check timing compatibility
  const vehicleAge = Date.now() - vehicle.lastPositionUpdate;
  if (vehicleAge > MAX_VEHICLE_AGE_MS) return false;

  // If we have a trip start time match, prefer it
  const startTimeMatch =
    Boolean(departure.tripStartTime) &&
    vehicle.startTime === departure.tripStartTime;

  // If no timing match, check proximity as a fallback
  if (!startTimeMatch) {
    const dist = haversineDistance(
      vehicle.lat, vehicle.lng,
      stopLat, stopLon,
    );
    // Only use proximity for nearby departures (within ~2km)
    if (dist > PROXIMITY_MATCH_RADIUS) return false;
  }

  return true;
}

/**
 * Calculate the estimated time of arrival (ETA) for a vehicle at a stop.
 *
 * Uses the vehicle's speed and distance to the stop to compute an ETA.
 * Falls back to schedule-based estimation if speed data is unavailable.
 */
export function calculateETA(
  vehicle: TrackedVehicle,
  stopLat: number,
  stopLon: number,
  scheduledDepartureUnix: number,
): { etaMinutes: number | null; distanceMeters: number } {
  const distanceMeters = haversineDistance(
    vehicle.lat, vehicle.lng,
    stopLat, stopLon,
  );

  // If the vehicle is at or past the stop, ETA is 0
  if (distanceMeters < 50) {
    return { etaMinutes: 0, distanceMeters };
  }

  // Use speed to estimate ETA
  // Speed is in m/s, so time = distance / speed
  const speedMps = Math.max(vehicle.speed, 0);

  if (speedMps > 0.5) {
    // Vehicle is moving — use actual speed
    const etaSeconds = distanceMeters / speedMps;
    const etaMinutes = etaSeconds / 60;

    // Clamp to reasonable range
    if (etaMinutes <= MAX_ETA_MINUTES) {
      return {
        etaMinutes: Math.round(etaMinutes * 10) / 10, // One decimal place
        distanceMeters,
      };
    }
  }

  // Fallback: estimate based on schedule offset
  // If the vehicle was last seen recently, assume it's roughly on schedule
  const now = Date.now() / 1000;
  const timeUntilScheduled = scheduledDepartureUnix - now;

  if (timeUntilScheduled > -60 && timeUntilScheduled < 3600) {
    // Vehicle is roughly on schedule — use the scheduled time
    return {
      etaMinutes: Math.max(0, Math.round(timeUntilScheduled / 60)),
      distanceMeters,
    };
  }

  // Can't estimate — schedule is too far off or vehicle is too old
  return { etaMinutes: null, distanceMeters };
}

/**
 * Compute the departure countdown for a single departure.
 *
 * Returns the matching vehicle, ETA, distance, and whether the data is predicted.
 */
export function computeDepartureCountdown(
  departure: StopDeparture,
  vehicles: Map<string, TrackedVehicle>,
  stopLat: number,
  stopLon: number,
): DepartureCountdown {
  let bestVehicle: TrackedVehicle | null = null;
  let bestStartTimeMatch = false;

  // Find the best matching vehicle
  for (const vehicle of vehicles.values()) {
    if (!findMatchingVehicle(vehicle, departure, stopLat, stopLon)) continue;

    const startTimeMatch =
      Boolean(departure.tripStartTime) &&
      vehicle.startTime === departure.tripStartTime;

    // Prefer exact startTime match, then most recent update
    if (
      !bestVehicle ||
      (startTimeMatch && !bestStartTimeMatch) ||
      (vehicle.lastPositionUpdate > bestVehicle.lastPositionUpdate)
    ) {
      bestVehicle = vehicle;
      bestStartTimeMatch = startTimeMatch;
    }
  }

  if (!bestVehicle) {
    return { vehicle: null, etaMinutes: null, distanceMeters: null, isPredicted: false };
  }

  const scheduledDepartureUnix = departure.serviceDay + departure.realtimeDeparture;
  const { etaMinutes, distanceMeters } = calculateETA(
    bestVehicle,
    stopLat,
    stopLon,
    scheduledDepartureUnix,
  );

  return {
    vehicle: bestVehicle,
    etaMinutes,
    distanceMeters,
    isPredicted: etaMinutes !== null,
  };
}

/**
 * Compute departure countdowns for all departures at a stop.
 *
 * Returns a map from departure index to countdown data for efficient rendering.
 */
export function computeAllDepartureCountdowns(
  departures: StopDeparture[],
  vehicles: Map<string, TrackedVehicle>,
  stopLat: number,
  stopLon: number,
): Map<number, DepartureCountdown> {
  const result = new Map<number, DepartureCountdown>();

  for (let i = 0; i < departures.length; i++) {
    result.set(i, computeDepartureCountdown(
      departures[i],
      vehicles,
      stopLat,
      stopLon,
    ));
  }

  return result;
}
