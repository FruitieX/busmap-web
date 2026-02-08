import { memo, useMemo, useEffect } from 'react';
import type { Stop, StopDeparture } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import { useStopStore, useSubscribedStopStore, useVehicleStore } from '@/stores';
import { useStopTimetable } from '@/lib';
import { DELAY_LATE_THRESHOLD, DELAY_EARLY_THRESHOLD } from '@/constants';
import { StarToggleButton } from './StarToggleButton';
import { getStopTermini } from '@/lib';

interface StopDetailsProps {
  stop: Stop;
  onBack: () => void;
  onDepartureClick: (departure: StopDeparture) => void;
  onVehicleDeselect?: () => void;
}

const formatDepartureTime = (serviceDay: number, departure: number): string => {
  const date = new Date((serviceDay + departure) * 1000);
  return date.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
};

const getMinutesUntil = (serviceDay: number, departure: number): number => {
  const departureMs = (serviceDay + departure) * 1000;
  return Math.round((departureMs - Date.now()) / 60000);
};

const formatDelay = (delaySeconds: number): string => {
  if (delaySeconds === 0) return 'On time';
  const minutes = Math.round(delaySeconds / 60);
  if (minutes === 0) return 'On time';
  if (minutes > 0) return `+${minutes} min`;
  return `${minutes} min`;
};

interface DepartureCardProps {
  departure: StopDeparture;
  onClick: () => void;
  vehicleOnMap: boolean;
}

const DepartureCard = memo(({ departure, onClick, vehicleOnMap }: DepartureCardProps) => {
  const color = TRANSPORT_COLORS[departure.routeMode] ?? TRANSPORT_COLORS.bus;
  const minutesUntil = getMinutesUntil(departure.serviceDay, departure.realtimeDeparture);
  const isCanceled = departure.realtimeState === 'CANCELED';

  const delayClass =
    departure.departureDelay > DELAY_LATE_THRESHOLD
      ? 'text-red-500'
      : departure.departureDelay < DELAY_EARLY_THRESHOLD
        ? 'text-green-500'
        : 'text-gray-500 dark:text-gray-400';

  return (
    <div
      className={`bg-gray-50 dark:bg-gray-800 rounded-xl p-2 min-[425px]:p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-150 ${isCanceled ? 'opacity-50' : ''} ${!vehicleOnMap && !isCanceled ? 'opacity-50' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        {/* Route badge */}
        <div
          className="w-10 h-10 min-[425px]:w-12 min-[425px]:h-12 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
          style={{ backgroundColor: color }}
        >
          {departure.routeShortName}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 dark:text-white truncate">
            {departure.headsign || departure.routeLongName}
          </div>
          <div className="flex items-center gap-2 text-xs">
            {isCanceled ? (
              <span className="text-red-500 font-medium">Canceled</span>
            ) : (
              <>
                {departure.realtime && (
                  <span className={delayClass}>{formatDelay(departure.departureDelay)}</span>
                )}
                {departure.realtime && <span className="text-gray-400">•</span>}
                <span className="text-gray-500 dark:text-gray-400 capitalize">{departure.routeMode}</span>
              </>
            )}
          </div>
        </div>

        {/* Time */}
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {formatDepartureTime(departure.serviceDay, departure.realtimeDeparture)}
          </div>
          <div className={`text-xs ${minutesUntil <= 1 ? 'text-primary-500 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
            {minutesUntil <= 0 ? 'Now' : `${minutesUntil} min`}
          </div>
        </div>
      </div>
    </div>
  );
});

DepartureCard.displayName = 'DepartureCard';

const StopDetailsComponent = ({ stop, onBack, onDepartureClick, onVehicleDeselect }: StopDetailsProps) => {
  const setStopDirections = useStopStore((state) => state.setStopDirections);
  const { data: timetable, isLoading } = useStopTimetable(stop.gtfsId);

  const isSubscribed = useSubscribedStopStore((state) => state.isStopSubscribed(stop.gtfsId));
  const subscribeToStop = useSubscribedStopStore((state) => state.subscribeToStop);
  const unsubscribeFromStop = useSubscribedStopStore((state) => state.unsubscribeFromStop);

  // Update direction filtering in the store when timetable loads
  useEffect(() => {
    if (timetable?.directions) {
      setStopDirections(timetable.directions);
    }
  }, [timetable?.directions, setStopDirections]);

  const color = TRANSPORT_COLORS[stop.vehicleMode] ?? TRANSPORT_COLORS.bus;
  const termini = useMemo(() => getStopTermini(stop.routes), [stop.routes]);

  // Build set of vehicle trip keys currently on the map for graying out departures
  const vehiclesMap = useVehicleStore((state) => state.vehicles);
  const vehicleTripKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const v of vehiclesMap.values()) {
      // Key matches the lookup in handleDepartureClick: routeId + direction + startTime
      keys.add(`${v.routeId}:${v.direction}:${v.startTime}`);
    }
    return keys;
  }, [vehiclesMap]);

  // Filter out past departures and canceled ones at the top
  const sortedDepartures = useMemo(() => {
    if (!timetable?.departures) return [];
    return timetable.departures.filter((d) => {
      const minutesUntil = getMinutesUntil(d.serviceDay, d.realtimeDeparture);
      return minutesUntil >= -1; // Show departures from 1 min ago onward
    });
  }, [timetable?.departures]);

  return (
    <div>
      {/* Header with back button */}
      <div className="flex items-center gap-3 mb-3 px-0.5">
        <button
          onClick={onBack}
          className="shrink-0 w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div
          className="flex-1 min-w-0 flex items-center gap-3 rounded-lg px-2 py-1 -mx-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          role="button"
          tabIndex={0}
          onClick={onVehicleDeselect}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${color}20`, border: `2px solid ${color}` }}
          >
            <StopIcon mode={stop.vehicleMode} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-medium text-gray-900 dark:text-white truncate">
              {stop.name}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex min-w-0">
              {stop.code && <span className="shrink-0">{stop.code} • </span>}
              <span className="capitalize shrink-0">{stop.vehicleMode}</span>
              <span className="text-gray-400 shrink-0"> • </span>
              <span className="truncate">{stop.routes.length} routes{termini && ` (${termini})`}</span>
            </div>
          </div>
        </div>

        {/* Save/remove stop button */}
        <StarToggleButton
          active={isSubscribed}
          onToggle={() => isSubscribed ? unsubscribeFromStop(stop.gtfsId) : subscribeToStop(stop)}
          title={isSubscribed ? 'Remove from saved stops' : 'Save stop'}
          size="md"
        />
      </div>

      {/* Timetable */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-8 h-8 mb-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading timetable...</p>
        </div>
      ) : sortedDepartures.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No upcoming departures</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[200px]">
            There are no scheduled departures from this stop right now
          </p>
        </div>
      ) : (
        <div className="space-y-2 px-0.5">
          {sortedDepartures.map((dep, i) => {
            const routeId = dep.routeGtfsId.replace('HSL:', '');
            const mqttDir = (dep.directionId + 1) as 1 | 2;
            const tripKey = `${routeId}:${mqttDir}:${dep.tripStartTime}`;
            return (
              <DepartureCard
                key={`${dep.routeGtfsId}-${dep.serviceDay}-${dep.scheduledDeparture}-${i}`}
                departure={dep}
                onClick={() => onDepartureClick(dep)}
                vehicleOnMap={vehicleTripKeys.has(tripKey)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

const StopIcon = ({ mode }: { mode: string }) => {
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

export const StopDetails = memo(StopDetailsComponent);
