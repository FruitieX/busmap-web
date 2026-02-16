import { memo, useMemo, useCallback } from 'react';
import type { TrackedVehicle } from '@/types';
import { useVehicleStore, useSubscriptionStore, useLocationStore, useSettingsStore } from '@/stores';
import { StarToggleButton } from './StarToggleButton';
import { resolveRouteColor } from '@/lib';
import {
  EARTH_RADIUS_M,
  MPS_TO_KMPH,
  KM_IN_METERS,
  DELAY_LATE_THRESHOLD,
  DELAY_EARLY_THRESHOLD,
  VEHICLE_FLY_TO_ZOOM,
} from '@/constants';

interface VehicleListProps {
  selectedVehicleId?: string | null;
  onVehicleClick?: (vehicle: TrackedVehicle) => void;
  onSubscribe?: (vehicle: TrackedVehicle) => void;
  onUnsubscribe?: (gtfsId: string) => void;
}

interface VehicleCardProps {
  vehicle: TrackedVehicle;
  distance?: number;
  isSubscribed: boolean;
  isSelected: boolean;
  onCardClick: () => void;
  onSubscriptionToggle: () => void;
}

const formatDelay = (delaySeconds: number): string => {
  if (delaySeconds === 0) return 'On time';
  const minutes = Math.round(delaySeconds / 60);
  if (minutes === 0) return 'On time';
  if (minutes > 0) return `+${minutes} min`;
  return `${minutes} min`;
};

const formatDistance = (meters: number): string => {
  if (meters < KM_IN_METERS) return `${Math.round(meters)} m`;
  return `${(meters / KM_IN_METERS).toFixed(1)} km`;
};

const formatSpeed = (mps: number): string => {
  const kmh = Math.round(mps * MPS_TO_KMPH);
  return `${kmh} km/h`;
};

const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = EARTH_RADIUS_M;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const VehicleCard = memo(
  ({ vehicle, distance, isSubscribed, isSelected, onCardClick, onSubscriptionToggle }: VehicleCardProps) => {
    const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
    const routeColorMode = useSettingsStore((state) => state.routeColorMode);
    const subscribed = subscribedRoutes.find(
      (r) => r.gtfsId === `HSL:${vehicle.routeId}` || r.shortName === vehicle.routeShortName
    );
    const color = resolveRouteColor({
      routeId: subscribed?.gtfsId ?? `HSL:${vehicle.routeId}`,
      mode: vehicle.mode,
      colorMode: routeColorMode,
      isSubscribed,
    });

    const delayClass =
      vehicle.delay > DELAY_LATE_THRESHOLD
        ? 'text-red-500'
        : vehicle.delay < DELAY_EARLY_THRESHOLD
          ? 'text-green-500'
          : 'text-gray-500 dark:text-gray-400';

    return (
      <div
        className={`bg-gray-50 dark:bg-gray-800 rounded-xl p-2 min-[425px]:p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-150 ${isSelected ? 'outline outline-2 outline-primary-500' : ''}`}
        onClick={onCardClick}
      >
        <div className="flex items-center gap-3">
          {/* Route badge */}
          <div
            className="w-10 h-10 min-[425px]:w-12 min-[425px]:h-12 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
            style={{ backgroundColor: color }}
          >
            {vehicle.routeShortName}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 dark:text-white truncate">
                {vehicle.headsign || 'Unknown destination'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={delayClass}>{formatDelay(vehicle.delay)}</span>
              <span className="text-gray-400">•</span>
              <span className="text-gray-500 dark:text-gray-400">{formatSpeed(vehicle.speed)}</span>
              {distance !== undefined && (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-gray-500 dark:text-gray-400">{formatDistance(distance)}</span>
                </>
              )}
            </div>
          </div>

          {/* Subscribe/unsubscribe button */}
          <StarToggleButton
            active={isSubscribed}
            onToggle={onSubscriptionToggle}
            title={isSubscribed ? 'Stop tracking' : 'Track this route'}
          />
        </div>
      </div>
    );
  }
);

VehicleCard.displayName = 'VehicleCard';

const VehicleListComponent = ({ selectedVehicleId, onVehicleClick, onSubscribe, onUnsubscribe }: VehicleListProps) => {
  const vehiclesMap = useVehicleStore((state) => state.vehicles);
  const vehicles = useMemo(() => Array.from(vehiclesMap.values()), [vehiclesMap]);
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const userLocation = useLocationStore((state) => state.userLocation);
  const flyToLocation = useLocationStore((state) => state.flyToLocation);

  // Pre-compute subscribed route IDs for O(1) lookup
  const subscribedRouteIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of subscribedRoutes) {
      ids.add(r.gtfsId);
      ids.add(r.shortName);
    }
    return ids;
  }, [subscribedRoutes]);

  // Calculate distances and sort vehicles
  const sortedVehicles = useMemo(() => {
    const withDistance = vehicles.map((v) => ({
      vehicle: v,
      distance: userLocation
        ? calculateDistance(userLocation.latitude, userLocation.longitude, v.lat, v.lng)
        : undefined,
      isSubscribed: subscribedRouteIds.has(`HSL:${v.routeId}`) || subscribedRouteIds.has(v.routeShortName),
    }));

    // Show subscribed vehicles first, then sort by distance
    return withDistance.sort((a, b) => {
      if (a.isSubscribed !== b.isSubscribed) {
        return a.isSubscribed ? -1 : 1;
      }
      if (a.distance !== undefined && b.distance !== undefined) {
        return a.distance - b.distance;
      }
      return 0;
    });
  }, [vehicles, subscribedRouteIds, userLocation]);

  const handleCardClick = useCallback(
    (vehicle: TrackedVehicle) => {
      flyToLocation(vehicle.lat, vehicle.lng, VEHICLE_FLY_TO_ZOOM);
      onVehicleClick?.(vehicle);
    },
    [flyToLocation, onVehicleClick]
  );

  const handleSubscriptionToggle = useCallback(
    (vehicle: TrackedVehicle, isSubscribed: boolean) => {
      if (isSubscribed) {
        onUnsubscribe?.(`HSL:${vehicle.routeId}`);
      } else {
        onSubscribe?.(vehicle);
      }
    },
    [onSubscribe, onUnsubscribe]
  );

  // Split vehicles into subscribed and nearby sections
  const subscribedVehicles = useMemo(
    () => sortedVehicles.filter((v) => v.isSubscribed),
    [sortedVehicles],
  );
  const nearbyVehicles = useMemo(
    () => sortedVehicles.filter((v) => !v.isSubscribed),
    [sortedVehicles],
  );

  if (sortedVehicles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No vehicles</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[220px]">
          Search for routes to track their vehicles, or enable nearby mode to discover vehicles near you
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-0.5">
      {subscribedVehicles.map(({ vehicle, distance, isSubscribed }) => (
        <VehicleCard
          key={vehicle.vehicleId}
          vehicle={vehicle}
          distance={distance}
          isSubscribed={isSubscribed}
          isSelected={selectedVehicleId === vehicle.vehicleId}
          onCardClick={() => handleCardClick(vehicle)}
          onSubscriptionToggle={() => handleSubscriptionToggle(vehicle, isSubscribed)}
        />
      ))}
      {nearbyVehicles.length > 0 && (
        <div className={subscribedVehicles.length > 0 ? 'pt-2' : ''}>
          <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">Nearby Vehicles</h3>
          <div className="space-y-2">
            {nearbyVehicles.map(({ vehicle, distance, isSubscribed }) => (
              <VehicleCard
                key={vehicle.vehicleId}
                vehicle={vehicle}
                distance={distance}
                isSubscribed={isSubscribed}
                isSelected={selectedVehicleId === vehicle.vehicleId}
                onCardClick={() => handleCardClick(vehicle)}
                onSubscriptionToggle={() => handleSubscriptionToggle(vehicle, isSubscribed)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const VehicleList = memo(VehicleListComponent);
