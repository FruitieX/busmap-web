import { memo, useMemo, useState, useEffect } from 'react';
import type { TrackedVehicle } from '@/types';
import { useSubscriptionStore, useLocationStore } from '@/stores';
import { TRANSPORT_COLORS } from '@/types';

// Staleness thresholds
const FADE_START_MS = 5000; // Start fading after 5 seconds
const FADE_END_MS = 10000; // Fully faded at 10 seconds
const EXIT_ANIMATION_MS = 300; // Exit animation duration

interface VehicleMarkerProps {
  vehicle: TrackedVehicle;
  size?: number;
}

const VehicleMarkerComponent = ({ vehicle, size = 32 }: VehicleMarkerProps) => {
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
  const staleness = useMemo(() => {
    const age = now - vehicle.lastUpdate;
    if (age <= FADE_START_MS) return 0;
    if (age >= FADE_END_MS) return 1;
    return (age - FADE_START_MS) / (FADE_END_MS - FADE_START_MS);
  }, [now, vehicle.lastUpdate]);

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

  // Rotate the marker based on heading
  const rotation = vehicle.heading || 0;

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
