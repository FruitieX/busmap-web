import { useState, useEffect, useRef, useCallback } from 'react';
import type { TrackedVehicle } from '@/types';
import { useSettingsStore } from '@/stores';
import { getVehicleTiming } from '@/constants';

// Meters per degree at a given latitude
const metersPerDegreeLat = 111_320;
const metersPerDegreeLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

// Extrapolate position, curving from velocity heading toward reported heading for turns.
export const extrapolate = (
  lat: number,
  lng: number,
  velocityHeading: number,
  reportedHeading: number,
  speed: number,
  speedAccel: number,
  dtSeconds: number,
): { lat: number; lng: number; heading: number } => {
  const avgSpeed = Math.max(0, speed + speedAccel * dtSeconds * 0.5);
  const distance = avgSpeed * dtSeconds;

  // Blend heading from velocity toward reported to handle turns
  const headingDiff = ((reportedHeading - velocityHeading + 540) % 360) - 180;
  const blend = 1 - Math.exp(-3 * dtSeconds);
  const endHeading = velocityHeading + headingDiff * blend;

  // Use midpoint heading for displacement (arc approximation)
  const blendMid = 1 - Math.exp(-1.5 * dtSeconds);
  const midHeading = velocityHeading + headingDiff * blendMid;
  const midRad = (midHeading * Math.PI) / 180;

  const newLat = lat + (distance * Math.cos(midRad)) / metersPerDegreeLat;
  const newLng = lng + (distance * Math.sin(midRad)) / metersPerDegreeLng(lat);

  return { lat: newLat, lng: newLng, heading: endHeading };
};

export interface AnimatedPosition {
  lat: number;
  lng: number;
  heading: number;
}

// Hook for animated vehicle position (used by popover anchor)
export const useAnimatedPosition = (vehicle: TrackedVehicle): AnimatedPosition => {
  const animateVehicles = useSettingsStore((state) => state.animateVehicles);
  const timing = getVehicleTiming(vehicle.mode);
  const rafRef = useRef<number>(0);

  // Additive correction offset that decays over time
  const offsetRef = useRef({ lat: 0, lng: 0, heading: 0 });
  const offsetTimeRef = useRef(0);
  const prevVehicleRef = useRef<{ lat: number; lng: number }>(vehicle);

  const [pos, setPos] = useState<AnimatedPosition>({
    lat: vehicle.lat,
    lng: vehicle.lng,
    heading: vehicle.heading,
  });

  // When the vehicle's known position changes, compute additive offset
  // so the marker doesn't jump — the offset decays over time
  useEffect(() => {
    const prev = prevVehicleRef.current;
    if (prev.lat !== vehicle.lat || prev.lng !== vehicle.lng) {
      // offset = currently displayed position - new baseline (at dt≈0, baseline ≈ vehicle.lat/lng)
      offsetRef.current = {
        lat: pos.lat - vehicle.lat,
        lng: pos.lng - vehicle.lng,
        heading: ((pos.heading - vehicle.heading + 540) % 360) - 180,
      };
      offsetTimeRef.current = Date.now();
      prevVehicleRef.current = { lat: vehicle.lat, lng: vehicle.lng };
    }
  }, [vehicle.lat, vehicle.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const animate = useCallback(() => {
    if (!animateVehicles) {
      setPos({ lat: vehicle.lat, lng: vehicle.lng, heading: vehicle.heading });
      return;
    }

    const now = Date.now();
    const timeSinceUpdate = now - vehicle.lastPositionUpdate;

    // Don't extrapolate if data is too stale or vehicle is stopped
    if (timeSinceUpdate > timing.maxExtrapolateMs || (vehicle.speed < 0.3 && (vehicle.acceleration ?? 0) <= 0)) {
      setPos({ lat: vehicle.lat, lng: vehicle.lng, heading: vehicle.heading });
      rafRef.current = requestAnimationFrame(animate);
      return;
    }

    // Extrapolate from the known position
    const dtSeconds = timeSinceUpdate / 1000;
    const predicted = extrapolate(
      vehicle.lat,
      vehicle.lng,
      vehicle.heading,
      vehicle.reportedHeading ?? vehicle.heading,
      vehicle.speed,
      vehicle.speedAcceleration ?? vehicle.acceleration ?? 0,
      dtSeconds,
    );

    // Apply decaying additive offset for smooth correction
    const offset = offsetRef.current;
    const correctionAge = now - offsetTimeRef.current;
    const decay = correctionAge < timing.correctionMs ? Math.exp(-4 * correctionAge / timing.correctionMs) : 0;

    const finalLat = predicted.lat + offset.lat * decay;
    const finalLng = predicted.lng + offset.lng * decay;
    const finalHeading = predicted.heading + offset.heading * decay;

    setPos({ lat: finalLat, lng: finalLng, heading: finalHeading });
    rafRef.current = requestAnimationFrame(animate);
  }, [vehicle.lat, vehicle.lng, vehicle.heading, vehicle.speed, vehicle.acceleration, vehicle.speedAcceleration, vehicle.lastPositionUpdate, animateVehicles, timing]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  return pos;
};
