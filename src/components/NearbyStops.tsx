import { memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Stop } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import { useStopStore, useSubscribedStopStore, useSettingsStore } from '@/stores';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { KM_IN_METERS } from '@/constants';

interface NearbyStopsProps {
  stops: Array<Stop & { distance: number }>;
  isLoading: boolean;
  onStopClick: (stop: Stop) => void;
}

const formatDistance = (meters: number): string => {
  if (meters < KM_IN_METERS) return `${Math.round(meters)} m`;
  return `${(meters / KM_IN_METERS).toFixed(1)} km`;
};

interface StopCardProps {
  stop: Stop & { distance?: number };
  isSelected: boolean;
  isSubscribed: boolean;
  onCardClick: () => void;
  onSubscriptionToggle: () => void;
}

const StopCard = memo(({ stop, isSelected, isSubscribed, onCardClick, onSubscriptionToggle }: StopCardProps) => {
  const color = TRANSPORT_COLORS[stop.vehicleMode] ?? TRANSPORT_COLORS.bus;

  // Group routes by mode, sorted
  const routeLabels = useMemo(() => {
    const uniqueRoutes = new Map<string, { shortName: string; mode: string }>();
    for (const r of stop.routes) {
      if (!uniqueRoutes.has(r.gtfsId)) {
        uniqueRoutes.set(r.gtfsId, { shortName: r.shortName, mode: r.mode });
      }
    }
    return Array.from(uniqueRoutes.values()).sort((a, b) => {
      const aNum = parseInt(a.shortName, 10);
      const bNum = parseInt(b.shortName, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.shortName.localeCompare(b.shortName);
    });
  }, [stop.routes]);

  return (
    <div
      className={`bg-gray-50 dark:bg-gray-800 rounded-xl p-2 min-[425px]:p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-150 ${isSelected ? 'outline outline-2 outline-primary-500' : ''}`}
      onClick={onCardClick}
    >
      <div className="flex items-center gap-3">
        {/* Stop icon */}
        <div
          className="w-10 h-10 min-[425px]:w-12 min-[425px]:h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}20`, border: `2px solid ${color}` }}
        >
          <StopIcon mode={stop.vehicleMode} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isSubscribed && (
              <span className="shrink-0 w-2 h-2 rounded-full bg-primary-500" title="Saved" />
            )}
            <span className="font-medium text-gray-900 dark:text-white truncate">
              {stop.name}
            </span>
            {stop.code && (
              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                {stop.code}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-500 dark:text-gray-400 capitalize">{stop.vehicleMode}</span>
            {stop.distance !== undefined && (
              <>
                <span className="text-gray-400">•</span>
                <span className="text-gray-500 dark:text-gray-400">{formatDistance(stop.distance)}</span>
              </>
            )}
            <span className="text-gray-400">•</span>
            <span className="text-gray-500 dark:text-gray-400">{routeLabels.length} routes</span>
          </div>
          {/* Route badges */}
          <div className="flex flex-wrap gap-1 mt-1">
            {routeLabels.slice(0, 8).map(({ shortName, mode }) => (
              <span
                key={shortName}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
                style={{ backgroundColor: TRANSPORT_COLORS[mode as keyof typeof TRANSPORT_COLORS] ?? TRANSPORT_COLORS.bus }}
              >
                {shortName}
              </span>
            ))}
            {routeLabels.length > 8 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700">
                +{routeLabels.length - 8}
              </span>
            )}
          </div>
        </div>

        {/* Subscribe/unsubscribe button */}
        {isSubscribed ? (
          <ConfirmDeleteButton
            onConfirm={onSubscriptionToggle}
            title="Remove stop"
          />
        ) : (
          <button
            className="shrink-0 w-8 h-8 min-[425px]:w-10 min-[425px]:h-10 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex items-center justify-center hover:bg-primary-100 dark:hover:bg-primary-900 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onSubscriptionToggle();
            }}
            title="Save this stop"
          >
            <svg className="w-4 h-4 min-[425px]:w-5 min-[425px]:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});

StopCard.displayName = 'StopCard';

const StopIcon = ({ mode }: { mode: string }) => {
  // Simple icon per mode
  switch (mode) {
    case 'tram':
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: TRANSPORT_COLORS.tram }}>
          <path d="M19 16.94V8.5c0-2.49-2.01-4.5-4.5-4.5h-5C7.01 4 5 6.01 5 8.5v8.44c0 .99.81 1.81 1.81 1.81h.31l-1.06 1.06 1.06 1.06 1.94-1.94h5.88l1.94 1.94 1.06-1.06-1.06-1.06h.31c.99 0 1.81-.82 1.81-1.81zM12 2l3 2H9l3-2zM8.5 14c-.83 0-1.5-.67-1.5-1.5S7.67 11 8.5 11s1.5.67 1.5 1.5S9.33 14 8.5 14zm7 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM17 9H7V7h10v2z" />
        </svg>
      );
    case 'train':
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: TRANSPORT_COLORS.train }}>
          <path d="M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
        </svg>
      );
    case 'metro':
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: TRANSPORT_COLORS.metro }}>
          <path d="M17.5 3H14v2h3.5c.83 0 1.5.67 1.5 1.5v11c0 .83-.67 1.5-1.5 1.5H17l2 3h-2l-2-3H9L7 22H5l2-3h-.5C5.67 19 5 18.33 5 17.5v-11C5 5.67 5.67 5 6.5 5H10V3H6.5C4.57 3 3 4.57 3 6.5v11C3 19.43 4.57 21 6.5 21h11c1.93 0 3.5-1.57 3.5-3.5v-11C21 4.57 19.43 3 17.5 3zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm5-6H7V7h10v4z" />
        </svg>
      );
    case 'ferry':
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: TRANSPORT_COLORS.ferry }}>
          <path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.13.52-.05.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z" />
        </svg>
      );
    default:
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: TRANSPORT_COLORS.bus }}>
          <path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z" />
        </svg>
      );
  }
};

const NearbyStopsComponent = ({ stops, isLoading, onStopClick }: NearbyStopsProps) => {
  const selectedStop = useStopStore((state) => state.selectedStop);
  const subscribedStops = useSubscribedStopStore((state) => state.subscribedStops);
  const { subscribeToStop, unsubscribeFromStop, isStopSubscribed } = useSubscribedStopStore();
  const showStops = useSettingsStore((state) => state.showStops);

  // Subscribed stop IDs for fast lookup
  const subscribedIds = useMemo(
    () => new Set(subscribedStops.map((s) => s.gtfsId)),
    [subscribedStops],
  );

  // Enrich subscribed stops with distance and routes from nearby data when available
  const subscribedStopCards = useMemo(() => {
    const nearbyMap = new Map(stops.map((s) => [s.gtfsId, s]));
    return subscribedStops.map((sub) => {
      const nearby = nearbyMap.get(sub.gtfsId);
      return {
        ...sub,
        routes: nearby?.routes ?? [],
        distance: nearby?.distance,
      } as Stop & { distance?: number };
    });
  }, [subscribedStops, stops]);

  // Nearby stops excluding subscribed ones
  const nearbyOnly = useMemo(
    () => stops.filter((s) => !subscribedIds.has(s.gtfsId)),
    [stops, subscribedIds],
  );

  const handleSubscriptionToggle = (stop: Stop) => {
    if (isStopSubscribed(stop.gtfsId)) {
      unsubscribeFromStop(stop.gtfsId);
    } else {
      subscribeToStop(stop);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-8 h-8 mb-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading nearby stops...</p>
      </div>
    );
  }

  if (subscribedStops.length === 0 && (!showStops || stops.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No stops</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[220px]">
          Search for stops to save them, or enable nearby mode to discover stops near you
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-0.5">
      {/* Subscribed stops always shown */}
      <AnimatePresence mode="popLayout" initial={false}>
        {subscribedStopCards.map((stop) => (
          <motion.div
            key={stop.gtfsId}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, x: -100 }}
            transition={{ opacity: { duration: 0.15 }, scale: { duration: 0.15 } }}
          >
            <StopCard
              stop={stop}
              isSelected={selectedStop?.gtfsId === stop.gtfsId}
              isSubscribed={true}
              onCardClick={() => onStopClick(stop)}
              onSubscriptionToggle={() => handleSubscriptionToggle(stop)}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Nearby stops section - only when showStops is enabled */}
      {showStops && nearbyOnly.length > 0 && (
        <div className={subscribedStops.length > 0 ? 'pt-2' : ''}>
          <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">Nearby Stops</h3>
          <div className="space-y-2">
            {nearbyOnly.map((stop) => (
              <StopCard
                key={stop.gtfsId}
                stop={stop}
                isSelected={selectedStop?.gtfsId === stop.gtfsId}
                isSubscribed={false}
                onCardClick={() => onStopClick(stop)}
                onSubscriptionToggle={() => handleSubscriptionToggle(stop)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const NearbyStops = memo(NearbyStopsComponent);
