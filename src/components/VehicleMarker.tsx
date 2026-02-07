import { memo, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import type { TrackedVehicle } from '@/types';
import { useSubscriptionStore, useLocationStore, useSettingsStore } from '@/stores';
import { TRANSPORT_COLORS } from '@/types';
import { getVehicleTiming } from '@/constants';

const EXIT_ANIMATION_MS = 300;

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

interface VehicleMarkerProps {
  vehicle: TrackedVehicle;
  heading: number;
  size?: number;
}

const VehicleMarkerComponent = ({ vehicle, heading: animatedHeading, size = 32 }: VehicleMarkerProps) => {
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const zoom = useLocationStore((state) => state.viewport.zoom);
  const [showPing, setShowPing] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Update time every 16ms during exit animation, 500ms otherwise for staleness fade
  useEffect(() => {
    const intervalMs = vehicle.exitingAt ? 16 : 500;
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [vehicle.exitingAt]);

  // Calculate exit progress (0 = just started, 1 = fully exited)
  const exitProgress = useMemo(() => {
    if (!vehicle.exitingAt) return 0;
    const elapsed = now - vehicle.exitingAt;
    return Math.max(0, Math.min(1, elapsed / EXIT_ANIMATION_MS));
  }, [now, vehicle.exitingAt]);

  // Calculate staleness (0 = fresh, 1 = fully stale)
  const timing = getVehicleTiming(vehicle.mode);
  const staleness = useMemo(() => {
    const age = now - vehicle.lastUpdate;
    if (age <= timing.fadeStartMs) return 0;
    if (age >= timing.fadeEndMs) return 1;
    return (age - timing.fadeStartMs) / (timing.fadeEndMs - timing.fadeStartMs);
  }, [now, vehicle.lastUpdate, timing]);

  // Scale ping based on zoom level (smaller when zoomed out)
  const pingScale = useMemo(() => {
    // At zoom 14+, full size. At zoom 10, half size. Below zoom 10, minimal
    if (zoom >= 14) return 1;
    if (zoom >= 10) return 0.5 + (zoom - 10) * 0.125;
    return 0.3;
  }, [zoom]);

  const { baseColor, isSubscribed } = useMemo(() => {
    const subscribed = subscribedRoutes.find(
      (r) => r.gtfsId === `HSL:${vehicle.routeId}` || r.shortName === vehicle.routeShortName
    );
    return {
      baseColor: subscribed?.color || TRANSPORT_COLORS[vehicle.mode] || TRANSPORT_COLORS.bus,
      isSubscribed: !!subscribed,
    };
  }, [subscribedRoutes, vehicle.routeId, vehicle.routeShortName, vehicle.mode]);

  // Interpolate color toward gray based on staleness
  const color = useMemo(() => {
    if (staleness === 0) return baseColor;
    // Lerp toward gray (#888888)
    const hex = baseColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const gray = 136; // #888888
    const newR = Math.round(r + (gray - r) * staleness);
    const newG = Math.round(g + (gray - g) * staleness);
    const newB = Math.round(b + (gray - b) * staleness);
    return `rgb(${newR}, ${newG}, ${newB})`;
  }, [baseColor, staleness]);

  // Calculate opacity: factor in both staleness and exit animation
  const opacity = (1 - staleness) * (1 - exitProgress);

  // Show ping animation on update
  useEffect(() => {
    setShowPing(true);
    const timer = setTimeout(() => setShowPing(false), 500);
    return () => clearTimeout(timer);
  }, [vehicle.lastUpdate]);

  // Rotate the marker based on animated heading
  const rotation = animatedHeading || 0;

  // Don't render if fully stale or exit animation complete
  if (staleness >= 1 || exitProgress >= 1) return null;

  return (
    <div
      className="relative flex items-center justify-center cursor-pointer transition-transform duration-150 hover:scale-110"
      style={{
        width: size,
        height: size,
        transform: `rotate(${rotation}deg) scale(${1 - exitProgress * 0.3})`,
        opacity,
        transition: vehicle.exitingAt ? 'none' : 'opacity 0.5s ease-out',
      }}
    >
      {/* Ping animation on update */}
      {showPing && (
        <div
          className="absolute rounded-full animate-ping"
          style={{
            width: size * pingScale,
            height: size * pingScale,
            backgroundColor: color,
            opacity: 0.3,
          }}
        />
      )}

      {/* Direction indicator (triangle pointing in heading direction) */}
      <svg
        width={size}
        height={size}
        viewBox="-4 -8 40 48"
        className="absolute"
        style={{ filter: isSubscribed ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' : 'none' }}
      >
        {/* Direction arrow - positioned above the circle */}
        <path
          d="M16 -4 L21 6 L16 3 L11 6 Z"
          fill="white"
          stroke={color}
          strokeWidth="1.5"
        />
        {/* Background circle */}
        <circle
          cx="16"
          cy="16"
          r="14"
          fill={color}
          stroke="white"
          strokeWidth={isSubscribed ? 2.5 : 1.5}
          opacity={isSubscribed ? 1 : 0.8}
        />
      </svg>

      {/* Route number (counter-rotate to stay readable) */}
      <span
        className="absolute text-white font-bold text-[10px] leading-none select-none"
        style={{
          transform: `rotate(${-rotation}deg)`,
          textShadow: '0 1px 2px rgba(0,0,0,0.3)',
        }}
      >
        {vehicle.routeShortName}
      </span>

      {/* Subscribed indicator ring */}
      {isSubscribed && (
        <div
          className="absolute rounded-full border-2 border-white animate-pulse-slow"
          style={{
            width: size + 8,
            height: size + 8,
            borderColor: color,
            opacity: 0.5,
          }}
        />
      )}
    </div>
  );
};

export const VehicleMarker = memo(VehicleMarkerComponent);
