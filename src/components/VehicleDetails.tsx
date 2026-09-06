import { DetailHeader, detailActionClass } from './DetailLayout';
import { DetailBackButton } from './DetailBackButton';
import { useEffect, useMemo, useState } from 'react';
import type { Route, Stop, TrackedVehicle, VehicleTripStop } from '@/types';
import { useLocationStore, useSettingsStore, useSubscriptionStore } from '@/stores';
import { haversineDistance, resolveRouteColor, useVehicleTrip } from '@/lib';
import { DELAY_EARLY_THRESHOLD, DELAY_LATE_THRESHOLD, MPS_TO_KMPH, getVehicleTiming } from '@/constants';
import { StarIcon } from './StarToggleButton';

interface VehicleDetailsProps {
  vehicle: TrackedVehicle;
  onBack: () => void;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  isFollowing?: boolean;
  onReFollow?: () => void;
  onRouteActivate?: (route: Route) => void;
  onStopClick: (stop: Stop) => void;
  backTitle?: string;
}

const formatDelay = (delaySeconds: number): string => {
  if (delaySeconds === 0) return 'On time';
  const minutes = Math.round(delaySeconds / 60);
  if (minutes === 0) return 'On time';
  if (minutes > 0) return `+${minutes} min late`;
  return `${Math.abs(minutes)} min early`;
};

const formatSpeed = (mps: number): string => {
  const kmh = Math.round(mps * MPS_TO_KMPH);
  return `${kmh} km/h`;
};

const formatLastUpdate = (lastUpdate: number, now: number): string => {
  const secondsAgo = Math.floor((now - lastUpdate) / 1000);
  if (secondsAgo <= 2) return 'now';
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  const minutes = Math.floor(secondsAgo / 60);
  return `${minutes}m ago`;
};

const normalizeStopId = (stopId: unknown): string =>
  typeof stopId === 'string' || typeof stopId === 'number' ? String(stopId).replace(/^HSL:/, '') : '';

const formatTripTime = (seconds: number | null): string => {
  if (seconds === null) return '-';
  return new Intl.DateTimeFormat('fi-FI', {
    timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit',
  }).format(new Date(seconds * 1000)).replace('.', ':');
};

const getStopDeparture = (stop: VehicleTripStop, vehicleDelay: number): number | null => {
  if (!Number.isFinite(stop.serviceDay) || stop.serviceDay <= 0) return null;
  const seconds = stop.realtime
    ? stop.realtimeDeparture ?? stop.realtimeArrival
    : stop.scheduledDeparture ?? stop.scheduledArrival;
  if (seconds === null || !Number.isFinite(seconds)) return null;
  return stop.serviceDay + seconds + (stop.realtime ? 0 : vehicleDelay);
};

const formatRelativeDeparture = (departure: number | null, now: number): string => {
  if (departure === null) return 'Time unavailable';
  const seconds = departure - now / 1000;
  if (seconds >= 60) return `In ${Math.ceil(seconds / 60)} min`;
  if (seconds >= 0) return 'Due now';
  if (seconds > -60) return '<1 min ago';
  return `${Math.floor(-seconds / 60)} min ago`;
};

type VehicleStopStatus = 'departed' | 'expected-departed' | 'next' | 'upcoming';

const isPastStop = (status: VehicleStopStatus): boolean =>
  status === 'departed' || status === 'expected-departed';

interface VehicleStopRow {
  stop: VehicleTripStop;
  status: VehicleStopStatus;
}

export const VehicleDetails = ({
  vehicle,
  onBack,
  onSubscribe,
  onUnsubscribe,
  isFollowing = true,
  onReFollow,
  onRouteActivate,
  onStopClick,
  backTitle = 'Back to vehicles',
}: VehicleDetailsProps) => {
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const routeColorMode = useSettingsStore((state) => state.routeColorMode);
  const [now, setNow] = useState(Date.now());
  const [showAllStops, setShowAllStops] = useState(false);
  const userLocation = useLocationStore((state) => state.userLocation);
  const isStale = now - vehicle.lastUpdate >= getVehicleTiming(vehicle.mode).fadeEndMs;
  const { data: vehicleTrip, isLoading: isTripLoading, isError: isTripError } = useVehicleTrip(vehicle);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const subscribed = subscribedRoutes.find(
    (route) => route.gtfsId === `HSL:${vehicle.routeId}` || route.shortName === vehicle.routeShortName,
  );
  const isSubscribed = !!subscribed;
  const route = {
    gtfsId: `HSL:${vehicle.routeId}`,
    shortName: vehicle.routeShortName,
    longName: vehicle.headsign,
    mode: vehicle.mode,
  } satisfies Route;
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
        : 'text-gray-600 dark:text-gray-400';

  const visibleStops = useMemo<VehicleStopRow[]>(() => {
    if (!vehicleTrip?.stops.length) return [];

    const nextStopId = normalizeStopId(vehicle.nextStopId);
    // Resolve repeated stops by the departure closest to the vehicle's timestamp.
    const matches = vehicleTrip.stops.flatMap((stop, index) =>
      nextStopId && normalizeStopId(stop.gtfsId) === nextStopId ? [index] : []);
    const nextStopIndex = matches.reduce((best, index) => {
      const distance = (i: number) => Math.abs((getStopDeparture(vehicleTrip.stops[i], vehicle.delay) ?? Infinity) - vehicle.lastUpdate / 1000);
      return best < 0 || distance(index) < distance(best) ? index : best;
    }, -1);

    // Live stop order takes precedence over predictions. Without a stop match,
    // use departure times, but distinguish expected departures from passed stops.
    const rows = vehicleTrip.stops.map<VehicleStopRow>((stop, index) => {
      const departure = getStopDeparture(stop, vehicle.delay);
      return {
        stop,
        status: nextStopIndex >= 0
          ? index < nextStopIndex ? 'departed' : index === nextStopIndex ? 'next' : 'upcoming'
          : departure !== null && departure < now / 1000 ? 'expected-departed' : 'upcoming',
      };
    });
    const past = rows.filter(({ status }) => isPastStop(status)).slice(-1);
    const upcoming = rows.filter(({ status }) => !isPastStop(status));
    return [...past, ...upcoming];
  }, [vehicle.nextStopId, vehicle.delay, vehicle.lastUpdate, vehicleTrip, now]);

  const nearestStop = useMemo(() => {
    if (!userLocation) return null;
    return visibleStops.filter(({ stop, status }) => !isPastStop(status) && stop.realtimeState !== 'CANCELED')
      .map(({ stop }) => ({ stop, distance: haversineDistance(userLocation.latitude, userLocation.longitude, stop.lat, stop.lon) }))
      .sort((a, b) => a.distance - b.distance)[0] ?? null;
  }, [visibleStops, userLocation]);
  const previewCount = 3 + (visibleStops.some(({ status }) => isPastStop(status)) ? 1 : 0);
  const shownStops = showAllStops ? visibleStops : visibleStops.slice(0, previewCount);

  const stopStatusLabel = (status: VehicleStopStatus): string => {
    if (status === 'next') return vehicle.doorStatus === 1 ? 'At stop' : 'Next stop';
    if (status === 'expected-departed') return 'Expected to have departed';
    return status === 'departed' ? 'Departed' : 'Upcoming';
  };

  return (
    <div className="space-y-3 px-0.5">
      <DetailBackButton label={backTitle} onClick={onBack} />
      <DetailHeader
        badge={<span className="flex h-11 min-w-11 items-center justify-center rounded-xl px-2 text-white font-bold" style={{ backgroundColor: color }}>{vehicle.routeShortName}</span>}
        title={vehicle.headsign || 'Unknown destination'}
        subtitle={<><span className="capitalize">{vehicle.mode} · Vehicle {vehicle.vehicleNumber}</span><span className={isStale ? 'text-amber-600 dark:text-amber-400' : delayClass}>{isStale ? 'Updates delayed' : formatDelay(vehicle.delay)}</span></>}
      />
      {isStale && (
        <div role="status" className="rounded-xl bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Last seen {formatLastUpdate(vehicle.lastUpdate, now)} · Waiting for vehicle updates
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button onClick={isSubscribed ? onUnsubscribe : onSubscribe}
          aria-label={isSubscribed ? 'Stop tracking route' : 'Track this route'} aria-pressed={isSubscribed}
          className={detailActionClass}>
          <StarIcon active={isSubscribed} className="w-4 h-4" />{isSubscribed ? 'Tracking' : 'Track route'}
        </button>
        {onRouteActivate && <button className={detailActionClass} onClick={() => onRouteActivate(route)}>Route {vehicle.routeShortName} →</button>}
        {!isFollowing && onReFollow && <button className={detailActionClass} onClick={onReFollow}>Follow vehicle</button>}
      </div>

      <div className="pt-1">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
          Trip stops
        </h3>
        {isTripLoading ? (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-sm text-gray-500 dark:text-gray-400">
            Loading stops...
          </div>
        ) : visibleStops.length > 0 ? (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl divide-y divide-gray-200 dark:divide-gray-700 overflow-hidden">
            {shownStops.map(({ stop, status }) => {
              const isCanceled = stop.realtimeState === 'CANCELED';
              const departure = getStopDeparture(stop, vehicle.delay);
              const isPast = isPastStop(status);
              // A vehicle still approaching a stop can outlast its prediction.
              // Describe that prediction as overdue, rather than as a departure.
              const relativeTime = !isPast && departure !== null && departure < now / 1000
                ? `${formatRelativeDeparture(departure, now).replace(' ago', '')} overdue`
                : status === 'departed' && departure !== null && departure >= now / 1000
                  ? 'Departed'
                  : formatRelativeDeparture(departure, now);
              const statusClass = status === 'next'
                ? 'text-primary-600 dark:text-primary-400'
                : isPast
                  ? 'text-gray-400 dark:text-gray-500'
                  : 'text-gray-500 dark:text-gray-400';

              return (
                <button
                  type="button"
                  key={`${stop.gtfsId}-${stop.stopPosition}`}
                  onClick={() => onStopClick({ ...stop, vehicleMode: vehicle.mode, routes: [route] })}
                  aria-label={`Show ${stop.name} on map`}
                  className={`w-full text-left flex items-center gap-3 px-3 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${status === 'next' ? 'bg-primary-50 dark:bg-primary-900' : ''} ${isCanceled || isPast ? 'opacity-60 hover:opacity-100 focus-visible:opacity-100' : ''}`}
                >
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${status === 'next' ? 'bg-primary-500 ring-4 ring-primary-100 dark:ring-primary-900' : 'border border-gray-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm text-gray-900 dark:text-white ${status === 'next' ? 'font-semibold' : ''}`}>{stop.name}</div>
                    <div className={`text-[11px] ${statusClass}`}>
                      {isCanceled ? 'Canceled' : stopStatusLabel(status)}{stop.code ? ` · ${stop.code}` : ''}
                    </div>
                    {nearestStop?.stop === stop && <div title="Nearest upcoming stop by straight-line distance, not a walking route" className="text-[11px] text-primary-600 dark:text-primary-400">Nearest to you · {nearestStop.distance < 1000 ? `${Math.round(nearestStop.distance)} m` : `${(nearestStop.distance / 1000).toFixed(1)} km`}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {isCanceled ? 'Canceled' : `${!stop.realtime && departure !== null && relativeTime !== 'Departed' ? '≈ ' : ''}${relativeTime}`}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      {formatTripTime(departure)}{!isCanceled && departure !== null ? stop.realtime ? ' · Live' : ' · Estimated' : ''}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-sm text-gray-500 dark:text-gray-400">
            {isTripError ? 'Stop information is temporarily unavailable.' : 'No trip stop information available.'}
          </div>
        )}
        {visibleStops.length > previewCount && <button type="button" aria-expanded={showAllStops} onClick={() => setShowAllStops(!showAllStops)} className="min-h-11 w-full text-sm font-medium text-primary-600 dark:text-primary-400">
          {showAllStops ? 'Show fewer stops' : `Show ${visibleStops.length - previewCount} more stops`}
        </button>}
      </div>

      <details className="rounded-xl border border-gray-200 dark:border-gray-800 text-sm">
        <summary className="cursor-pointer px-3 py-3 font-medium text-gray-600 dark:text-gray-300">Vehicle activity</summary>
        <dl className="grid grid-cols-2 gap-3 px-3 pb-3 text-xs text-gray-500 dark:text-gray-400">
          <div><dt>Speed</dt><dd className="mt-1 font-medium text-gray-900 dark:text-white">{formatSpeed(vehicle.speed)}</dd></div>
          <div><dt>Last update</dt><dd className="mt-1 font-medium text-gray-900 dark:text-white">{formatLastUpdate(vehicle.lastUpdate, now)}</dd></div>
        </dl>
      </details>

      {developerMode && (
        <details className="text-xs text-gray-500 dark:text-gray-500 space-y-1 font-mono bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
          <summary className="cursor-pointer font-sans font-medium py-1">Technical details</summary>
          <div className="flex justify-between gap-3">
            <span>Vehicle ID:</span>
            <span className="text-right break-all">{vehicle.vehicleId}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Route ID:</span>
            <span>{vehicle.routeId}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Position:</span>
            <span>{vehicle.lat.toFixed(5)}, {vehicle.lng.toFixed(5)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Heading:</span>
            <span>{vehicle.heading?.toFixed(0) ?? 'N/A'} deg</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Acceleration:</span>
            <span>{vehicle.acceleration?.toFixed(2) ?? 'N/A'} m/s2</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Door status:</span>
            <span>{vehicle.doorStatus === 1 ? 'Open' : 'Closed'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Occupancy:</span>
            <span>{vehicle.occupancy}%</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Operating day:</span>
            <span>{vehicle.operatingDay}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Start time:</span>
            <span>{vehicle.startTime}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Next stop:</span>
            <span>{vehicle.nextStopId || 'N/A'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Operator:</span>
            <span>{vehicle.operatorId}</span>
          </div>
        </details>
      )}

    </div>
  );
};
