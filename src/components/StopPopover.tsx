import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Stop, Route } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import { useSubscribedStopStore } from '@/stores';

interface StopPopoverProps {
  stop: Stop;
  onClose: () => void;
  onRouteActivate?: (route: Route) => void;
}

const StopPopoverComponent = ({ stop, onClose, onRouteActivate }: StopPopoverProps) => {
  const { subscribeToStop, unsubscribeFromStop, isStopSubscribed } = useSubscribedStopStore();
  const color = TRANSPORT_COLORS[stop.vehicleMode] ?? TRANSPORT_COLORS.bus;
  const saved = isStopSubscribed(stop.gtfsId);

  // Group routes by mode, sorted numerically
  const routeLabels = useMemo(() => {
    const uniqueRoutes = new Map<string, { gtfsId: string; shortName: string; longName: string; mode: string }>();
    for (const r of stop.routes) {
      if (!uniqueRoutes.has(r.gtfsId)) {
        uniqueRoutes.set(r.gtfsId, { gtfsId: r.gtfsId, shortName: r.shortName, longName: r.longName, mode: r.mode });
      }
    }
    return Array.from(uniqueRoutes.values()).sort((a, b) => {
      const aNum = parseInt(a.shortName, 10);
      const bNum = parseInt(b.shortName, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.shortName.localeCompare(b.shortName);
    });
  }, [stop.routes]);

  const handleToggleSubscription = () => {
    if (saved) {
      unsubscribeFromStop(stop.gtfsId);
    } else {
      subscribeToStop(stop);
    }
  };

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
        <div
          className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}20`, border: `2px solid ${color}` }}
        >
          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill={color} viewBox="0 0 24 24">
            <path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 14 8 14s8-8.75 8-14c0-4.42-3.58-8-8-8zm0 11c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm sm:text-base text-gray-900 dark:text-white line-clamp-2 leading-4 sm:leading-5">
            {stop.name}
            {stop.code && (
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5">{stop.code}</span>
            )}
          </div>
          <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 capitalize">
            {stop.vehicleMode} stop • {routeLabels.length} routes
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

      {/* Route badges */}
      {routeLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2 sm:mb-3">
          {routeLabels.slice(0, 12).map(({ gtfsId, shortName, longName, mode }) => (
            <button
              key={shortName}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-semibold text-white hover:opacity-80 transition-opacity cursor-pointer"
              style={{ backgroundColor: TRANSPORT_COLORS[mode as keyof typeof TRANSPORT_COLORS] ?? TRANSPORT_COLORS.bus }}
              onClick={(e) => {
                e.stopPropagation();
                onRouteActivate?.({ gtfsId, shortName, longName, mode: mode as Route['mode'] });
              }}
              title={longName}
            >
              {shortName}
            </button>
          ))}
          {routeLabels.length > 12 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700">
              +{routeLabels.length - 12}
            </span>
          )}
        </div>
      )}

      {/* Save/unsave button */}
      <button
        onClick={handleToggleSubscription}
        className={`w-full py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
          saved
            ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            : 'text-white hover:opacity-90'
        }`}
        style={!saved ? { backgroundColor: color } : {}}
      >
        {saved ? 'Remove saved stop' : 'Save this stop'}
      </button>
    </motion.div>
  );
};

export const StopPopover = memo(StopPopoverComponent);
