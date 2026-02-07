import { useState, useEffect, useRef } from 'react';
import type { TrackedVehicle } from '@/types';
import { useSettingsStore } from '@/stores';
import { interpolateVehicle, type InterpolatedPosition } from '@/lib/interpolation';

// Re-export for consumers that import from this file
export type { InterpolatedPosition } from '@/lib/interpolation';
export { extrapolate } from '@/lib/interpolation';

/**
 * Hook for animated vehicle position (used by popover anchor).
 *
 * Delegates all extrapolation and smooth-correction logic to the shared
 * interpolation engine so the popover stays in sync with the GeoJSON markers.
 */
export const useAnimatedPosition = (vehicle: TrackedVehicle): InterpolatedPosition => {
  const animateVehicles = useSettingsStore((state) => state.animateVehicles);
  const rafRef = useRef(0);
  const vehicleRef = useRef(vehicle);
  vehicleRef.current = vehicle;

  const [pos, setPos] = useState<InterpolatedPosition>(() => ({
    lat: vehicle.lat,
    lng: vehicle.lng,
    heading: vehicle.heading,
  }));

  useEffect(() => {
    if (!animateVehicles) return;

    const animate = () => {
      setPos(interpolateVehicle(vehicleRef.current, Date.now(), 'popover'));
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animateVehicles]);

  // When animation is off, return the raw store position directly
  if (!animateVehicles) {
    return { lat: vehicle.lat, lng: vehicle.lng, heading: vehicle.heading };
  }

  return pos;
};
