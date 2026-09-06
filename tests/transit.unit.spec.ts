import { test, expect } from '@playwright/test';
import { findMatchingVehicle, computeDepartureCountdown } from '../src/lib/departureCountdown';
import { extrapolate } from '../src/lib/interpolation';
import { useVehicleStore } from '../src/stores/vehicleStore';
import type { StopDeparture, TrackedVehicle } from '../src/types';

const vehicle = (): TrackedVehicle => ({
  vehicleId: '12/42', operatorId: 12, vehicleNumber: 42, lat: 60.17, lng: 24.94,
  heading: 0, speed: 10, acceleration: 0, routeId: '2551', routeShortName: '551',
  direction: 1, headsign: 'Pasila', startTime: '12:00', operatingDay: '2026-09-06',
  delay: 120, nextStopId: '1220102', doorStatus: 0, occupancy: 20,
  timestamp: new Date(), receivedAt: new Date(), mode: 'bus', isSubscribed: true,
  lastUpdate: Date.now(), lastPositionUpdate: Date.now() - 120_000,
});
const departure = (): StopDeparture => ({
  routeGtfsId: 'HSL:2551', routeShortName: '551', routeLongName: 'Westend - Pasila', routeMode: 'bus',
  directionId: 0, headsign: 'Pasila', tripStartTime: '12:00',
  serviceDay: Date.parse('2026-09-05T21:00:00Z') / 1000,
  scheduledDeparture: 43_500, realtimeDeparture: 43_620, departureDelay: 120,
  realtime: true, realtimeState: 'UPDATED',
});

test('trip matching requires route, direction, start time and operating day', () => {
  expect(findMatchingVehicle(vehicle(), departure(), 60.17, 24.94)).toBe(true);
  for (const changes of [
    { routeId: '2552' }, { direction: 2 as const }, { startTime: '12:10' },
    { operatingDay: '2026-09-05' }, { lastUpdate: Date.now() - 61_000 }, { exitingAt: Date.now() },
  ]) {
    expect(findMatchingVehicle({ ...vehicle(), ...changes }, departure(), 60.17, 24.94)).toBe(false);
  }
  expect(findMatchingVehicle(vehicle(), { ...departure(), realtimeState: 'CANCELED' }, 60.17, 24.94)).toBe(false);
});

test('stationary live vehicles remain matchable; predictions apply delay only once', () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-09-06T09:00:00Z');
  try {
    const correct = vehicle();
    const otherTrip = { ...vehicle(), vehicleId: '12/43', startTime: '12:10', lastUpdate: Date.now() + 1 };
    const vehicles = new Map([[correct.vehicleId, correct], [otherTrip.vehicleId, otherTrip]]);
    const live = computeDepartureCountdown(departure(), vehicles, correct.lat, correct.lng);
    expect(live.vehicle?.vehicleId).toBe(correct.vehicleId);
    expect(live.etaMinutes).toBe(7); // proximity must not turn a future departure into "arriving"
    const estimated = computeDepartureCountdown({ ...departure(), realtime: false }, vehicles, correct.lat, correct.lng);
    expect(estimated.etaMinutes).toBe(7);
    expect(estimated.isPredicted).toBe(true);
  } finally { Date.now = originalNow; }
});

test('braking extrapolation holds its stopping position instead of moving backwards', () => {
  const stopped = extrapolate(60, 25, 0, 0, 10, -5, 2);
  const later = extrapolate(60, 25, 0, 0, 10, -5, 4);
  expect(later.lat).toBe(stopped.lat);
  expect(later.lat).toBeGreaterThan(60);
  expect(later.lng).toBe(25);
});

test('out-of-order MQTT samples cannot overwrite a newer vehicle position', () => {
  useVehicleStore.getState().clearVehicles();
  const latest = { ...vehicle(), timestamp: new Date(2000) };
  const earlier = { ...vehicle(), timestamp: new Date(1000), lat: 61 };
  useVehicleStore.getState().updateVehicles([latest, earlier]);
  expect(useVehicleStore.getState().vehicles.get(latest.vehicleId)?.lat).toBe(latest.lat);
  useVehicleStore.getState().updateVehicle(earlier);
  expect(useVehicleStore.getState().vehicles.get(latest.vehicleId)?.lat).toBe(latest.lat);
  useVehicleStore.getState().clearVehicles();
});
