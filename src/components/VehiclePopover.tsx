import { memo, useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { TrackedVehicle } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import { useSubscriptionStore, useSettingsStore } from '@/stores';

interface VehiclePopoverProps {
  vehicle: TrackedVehicle;
  onClose: () => void;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  anchor?: 'top' | 'bottom';
}

const formatDelay = (delaySeconds: number): string => {
  if (delaySeconds === 0) return 'On time';
  const minutes = Math.round(delaySeconds / 60);
  if (minutes === 0) return 'On time';
  if (minutes > 0) return `+${minutes} min late`;
  return `${Math.abs(minutes)} min early`;
};

const formatSpeed = (mps: number): string => {
  const kmh = Math.round(mps * 3.6);
  return `${kmh} km/h`;
};

const formatLastUpdate = (lastUpdate: number, now: number): string => {
  const secondsAgo = Math.floor((now - lastUpdate) / 1000);
  if (secondsAgo <= 2) return 'now';
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  const minutes = Math.floor(secondsAgo / 60);
  return `${minutes}m ago`;
};

const VehiclePopoverComponent = ({ vehicle, onClose, onSubscribe, onUnsubscribe, anchor = 'bottom' }: VehiclePopoverProps) => {
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const [now, setNow] = useState(Date.now());

  // Update time every second for "last update" display
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { color, isSubscribed } = useMemo(() => {
    const subscribed = subscribedRoutes.find(
      (r) => r.gtfsId === `HSL:${vehicle.routeId}` || r.shortName === vehicle.routeShortName
    );
    return {
      color: subscribed?.color || TRANSPORT_COLORS[vehicle.mode] || TRANSPORT_COLORS.bus,
      isSubscribed: !!subscribed,
    };
  }, [subscribedRoutes, vehicle.routeId, vehicle.routeShortName, vehicle.mode]);

  const delayClass =
    vehicle.delay > 60
      ? 'text-red-500'
      : vehicle.delay < -60
        ? 'text-green-500'
        : 'text-gray-600 dark:text-gray-400';

  // Popover appears above vehicle (arrow points down) or below vehicle (arrow points up)
  const isAbove = anchor === 'bottom';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: isAbove ? 10 : -10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: isAbove ? 10 : -10 }}
      className={`relative z-50 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-2 sm:p-3 min-w-[160px] sm:min-w-[200px] pointer-events-auto ${isAbove ? 'mb-3 sm:mb-4' : 'mt-3 sm:mt-4'}`}
    >
      {/* Arrow pointing to vehicle */}
      {isAbove ? (
        <div className="absolute left-1/2 -bottom-2 -translate-x-1/2">
          <div className="w-3 h-3 bg-white dark:bg-gray-800 border-r border-b border-gray-200 dark:border-gray-700 rotate-45" />
        </div>
      ) : (
        <div className="absolute left-1/2 -top-2 -translate-x-1/2">
          <div className="w-3 h-3 bg-white dark:bg-gray-800 border-l border-t border-gray-200 dark:border-gray-700 rotate-45" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
        <div
          className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs sm:text-sm shrink-0"
          style={{ backgroundColor: color }}
        >
          {vehicle.routeShortName}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm sm:text-base text-gray-900 dark:text-white truncate">
            {vehicle.headsign || 'Unknown destination'}
          </div>
          <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 capitalize">
            {vehicle.mode} • Vehicle {vehicle.vehicleNumber}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 w-6 h-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center"
        >
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm mb-2 sm:mb-3">
        <span className={delayClass}>{formatDelay(vehicle.delay)}</span>
        <span className="text-gray-400">•</span>
        <span className="text-gray-600 dark:text-gray-400">{formatSpeed(vehicle.speed)}</span>
        <span className="text-gray-400">•</span>
        <span className="text-gray-500 dark:text-gray-500">{formatLastUpdate(vehicle.lastUpdate, now)}</span>
      </div>

      {/* Developer mode stats */}
      {developerMode && (
        <div className="text-xs text-gray-500 dark:text-gray-500 mb-3 space-y-1 font-mono bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
          <div className="flex justify-between">
            <span>Vehicle ID:</span>
            <span>{vehicle.vehicleId}</span>
          </div>
          <div className="flex justify-between">
            <span>Route ID:</span>
            <span>{vehicle.routeId}</span>
          </div>
          <div className="flex justify-between">
            <span>Direction:</span>
            <span>{vehicle.direction}</span>
          </div>
          <div className="flex justify-between">
            <span>Position:</span>
            <span>{vehicle.lat.toFixed(5)}, {vehicle.lng.toFixed(5)}</span>
          </div>
          <div className="flex justify-between">
            <span>Heading:</span>
            <span>{vehicle.heading}°</span>
          </div>
          <div className="flex justify-between">
            <span>Acceleration:</span>
            <span>{vehicle.acceleration?.toFixed(2) ?? 'N/A'} m/s²</span>
          </div>
          <div className="flex justify-between">
            <span>Door status:</span>
            <span>{vehicle.doorStatus === 1 ? 'Open' : 'Closed'}</span>
          </div>
          <div className="flex justify-between">
            <span>Occupancy:</span>
            <span>{vehicle.occupancy}%</span>
          </div>
          <div className="flex justify-between">
            <span>Operating day:</span>
            <span>{vehicle.operatingDay}</span>
          </div>
          <div className="flex justify-between">
            <span>Start time:</span>
            <span>{vehicle.startTime}</span>
          </div>
          <div className="flex justify-between">
            <span>Next stop:</span>
            <span>{vehicle.nextStopId || 'N/A'}</span>
          </div>
          <div className="flex justify-between">
            <span>Operator:</span>
            <span>{vehicle.operatorId}</span>
          </div>
        </div>
      )}

      {/* Subscribe button */}
      <button
        onClick={isSubscribed ? onUnsubscribe : onSubscribe}
        className={`w-full py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
          isSubscribed
            ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            : 'text-white hover:opacity-90'
        }`}
        style={!isSubscribed ? { backgroundColor: color } : {}}
      >
        {isSubscribed ? 'Stop tracking route' : 'Track this route'}
      </button>
    </motion.div>
  );
};

export const VehiclePopover = memo(VehiclePopoverComponent);
