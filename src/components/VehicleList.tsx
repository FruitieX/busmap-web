import { memo, useMemo, useCallback, forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TrackedVehicle } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import { useVehicleStore, useSubscriptionStore, useLocationStore } from '@/stores';

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
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
};

const formatSpeed = (mps: number): string => {
  const kmh = Math.round(mps * 3.6);
  return `${kmh} km/h`;
};

const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000; // Earth's radius in meters
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
  forwardRef<HTMLDivElement, VehicleCardProps>(
    ({ vehicle, distance, isSubscribed, isSelected, onCardClick, onSubscriptionToggle }, ref) => {
      const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
      const subscribed = subscribedRoutes.find(
        (r) => r.gtfsId === `HSL:${vehicle.routeId}` || r.shortName === vehicle.routeShortName
      );
      const color = subscribed?.color || TRANSPORT_COLORS[vehicle.mode] || TRANSPORT_COLORS.bus;

      const delayClass =
        vehicle.delay > 60
          ? 'text-red-500'
          : vehicle.delay < -60
            ? 'text-green-500'
            : 'text-gray-500 dark:text-gray-400';

      return (
        <motion.div
          ref={ref}
          layout
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, x: -100 }}
          transition={{
            layout: { type: 'spring', stiffness: 500, damping: 35, mass: 0.8 },
            opacity: { duration: 0.15 },
            scale: { duration: 0.15 },
          }}
          className={`bg-gray-50 dark:bg-gray-800 rounded-xl p-2 min-[425px]:p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${isSelected ? 'outline outline-2 outline-primary-500' : ''}`}
          onClick={onCardClick}
        >
        <div className="flex items-center gap-2 min-[425px]:gap-3">
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
              {isSubscribed && (
                <span className="shrink-0 w-2 h-2 rounded-full bg-primary-500" title="Tracked" />
              )}
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
          <button
            className={`group shrink-0 w-8 h-8 min-[425px]:w-10 min-[425px]:h-10 rounded-full flex items-center justify-center transition-colors ${
              isSubscribed
                ? 'bg-primary-100 dark:bg-primary-900 text-primary-600 dark:text-primary-400 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onSubscriptionToggle();
            }}
            title={isSubscribed ? 'Stop tracking' : 'Track this route'}
          >
            {isSubscribed ? (
              <>
                <svg className="w-4 h-4 min-[425px]:w-5 min-[425px]:h-5 group-hover:hidden" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <svg className="w-4 h-4 min-[425px]:w-5 min-[425px]:h-5 hidden group-hover:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </>
            ) : (
              <svg className="w-4 h-4 min-[425px]:w-5 min-[425px]:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
          </button>
        </div>
      </motion.div>
    );
  }
  )
);

VehicleCard.displayName = 'VehicleCard';

const VehicleListComponent = ({ selectedVehicleId, onVehicleClick, onSubscribe, onUnsubscribe }: VehicleListProps) => {
  const vehiclesMap = useVehicleStore((state) => state.vehicles);
  const vehicles = useMemo(() => Array.from(vehiclesMap.values()), [vehiclesMap]);
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const userLocation = useLocationStore((state) => state.userLocation);
  const flyToLocation = useLocationStore((state) => state.flyToLocation);

  // Calculate distances and sort vehicles
  const sortedVehicles = useMemo(() => {
    const withDistance = vehicles.map((v) => ({
      vehicle: v,
      distance: userLocation
        ? calculateDistance(userLocation.latitude, userLocation.longitude, v.lat, v.lng)
        : undefined,
      isSubscribed: subscribedRoutes.some(
        (r) => r.gtfsId === `HSL:${v.routeId}` || r.shortName === v.routeShortName
      ),
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
  }, [vehicles, subscribedRoutes, userLocation]);

  const handleCardClick = useCallback(
    (vehicle: TrackedVehicle) => {
      flyToLocation(vehicle.lat, vehicle.lng, 16);
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
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[200px]">
          Add routes to track vehicles in real-time
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-0.5 py-0.5">
      <AnimatePresence mode="popLayout" initial={false}>
        {sortedVehicles.map(({ vehicle, distance, isSubscribed }) => (
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
      </AnimatePresence>
    </div>
  );
};

export const VehicleList = memo(VehicleListComponent);
