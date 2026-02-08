import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { SubscribedRoute, RoutePattern, TrackedVehicle, Route } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import { EARTH_RADIUS_M, KM_IN_METERS } from '@/constants';

interface RoutePopoverProps {
  route: SubscribedRoute | Route;
  isSubscribed: boolean;
  patterns?: RoutePattern[];
  vehicles: TrackedVehicle[];
  onClose: () => void;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  onBackToStop?: () => void;
}

const formatDistance = (meters: number): string => {
  if (meters < KM_IN_METERS) return `${Math.round(meters)} m`;
  return `${(meters / KM_IN_METERS).toFixed(1)} km`;
};

const calculateRouteLength = (patterns: RoutePattern[]): number => {
  let maxLength = 0;
  for (const pattern of patterns) {
    let length = 0;
    for (let i = 1; i < pattern.geometry.length; i++) {
      const prev = pattern.geometry[i - 1];
      const curr = pattern.geometry[i];
      // Haversine distance
      const R = EARTH_RADIUS_M;
      const dLat = ((curr.lat - prev.lat) * Math.PI) / 180;
      const dLon = ((curr.lon - prev.lon) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((prev.lat * Math.PI) / 180) *
          Math.cos((curr.lat * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      length += R * c;
    }
    maxLength = Math.max(maxLength, length);
  }
  return maxLength;
};

const RoutePopoverComponent = ({ route, isSubscribed, patterns, vehicles, onClose, onSubscribe, onUnsubscribe, onBackToStop }: RoutePopoverProps) => {
  const color = ('color' in route && route.color) || TRANSPORT_COLORS[route.mode ?? 'bus'] || TRANSPORT_COLORS.bus;

  const stats = useMemo(() => {
    const routeLength = patterns && patterns.length > 0 ? calculateRouteLength(patterns) : 0;
    const directions = patterns?.length || 0;
    const activeVehicles = vehicles.filter(
      (v) => v.routeId === route.gtfsId.replace('HSL:', '') || v.routeShortName === route.shortName
    ).length;

    return { routeLength, directions, activeVehicles };
  }, [patterns, vehicles, route]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 10 }}
      className="relative z-50 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-2 sm:p-3 min-w-[180px] sm:min-w-[220px] max-w-[300px] sm:max-w-[500px] pointer-events-auto mb-3 sm:mb-4"
    >
      {/* Arrow pointing down */}
      <div className="absolute left-1/2 -bottom-2 -translate-x-1/2">
        <div className="w-3 h-3 bg-white dark:bg-gray-800 border-r border-b border-gray-200 dark:border-gray-700 rotate-45" />
      </div>

      {/* Header */}
      <div className="flex items-start gap-2 sm:gap-3 mb-1.5 sm:mb-2">
        {onBackToStop && (
          <button
            onClick={onBackToStop}
            className="shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Back to stop"
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div
          className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs sm:text-sm shrink-0"
          style={{ backgroundColor: color }}
        >
          {route.shortName}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm sm:text-base text-gray-900 dark:text-white line-clamp-2 leading-4 sm:leading-5"
            title={route.longName || `Route ${route.shortName}`}
          >
            {route.longName || `Route ${route.shortName}`}
          </div>
          <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 capitalize">
            {route.mode}
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
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-center mb-2 sm:mb-3">
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-1.5 sm:p-2">
          <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">{stats.activeVehicles}</div>
          <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Vehicles</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-1.5 sm:p-2">
          <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">{stats.directions}</div>
          <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Directions</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-1.5 sm:p-2">
          <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
            {stats.routeLength > 0 ? formatDistance(stats.routeLength) : '—'}
          </div>
          <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">Length</div>
        </div>
      </div>

      {/* Subscribe/Unsubscribe button */}
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

export const RoutePopover = memo(RoutePopoverComponent);
