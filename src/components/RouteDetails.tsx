import { DetailHeader, detailActionClass } from './DetailLayout';
import { DetailBackButton } from './DetailBackButton';
import type { Route, RoutePattern, SubscribedRoute, TrackedVehicle } from '@/types';
import { useSettingsStore } from '@/stores';
import { resolveRouteColor } from '@/lib';
import { DELAY_EARLY_THRESHOLD, DELAY_LATE_THRESHOLD, EARTH_RADIUS_M, KM_IN_METERS, MPS_TO_KMPH } from '@/constants';
import { StarIcon } from './StarToggleButton';

interface RouteDetailsProps {
  route: SubscribedRoute | Route;
  isSubscribed: boolean;
  patterns?: RoutePattern[];
  vehicles: TrackedVehicle[];
  onBack: () => void;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  onReCenter?: () => void;
  onVehicleSelect?: (vehicle: TrackedVehicle) => void;
  backTitle?: string;
}

const formatDistance = (meters: number): string => {
  if (meters < KM_IN_METERS) return `${Math.round(meters)} m`;
  return `${(meters / KM_IN_METERS).toFixed(1)} km`;
};

const formatDelay = (delaySeconds: number): string => {
  if (delaySeconds === 0) return 'On time';
  const minutes = Math.round(delaySeconds / 60);
  if (minutes === 0) return 'On time';
  if (minutes > 0) return `+${minutes} min`;
  return `${minutes} min`;
};

const formatSpeed = (mps: number): string => `${Math.round(mps * MPS_TO_KMPH)} km/h`;

const calculateRouteLength = (patterns: RoutePattern[]): number => {
  let maxLength = 0;
  for (const pattern of patterns) {
    let length = 0;
    for (let i = 1; i < pattern.geometry.length; i++) {
      const prev = pattern.geometry[i - 1];
      const curr = pattern.geometry[i];
      const dLat = ((curr.lat - prev.lat) * Math.PI) / 180;
      const dLon = ((curr.lon - prev.lon) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((prev.lat * Math.PI) / 180) *
          Math.cos((curr.lat * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      length += EARTH_RADIUS_M * c;
    }
    maxLength = Math.max(maxLength, length);
  }
  return maxLength;
};

export const RouteDetails = ({
  route,
  isSubscribed,
  patterns,
  vehicles,
  onBack,
  onSubscribe,
  onUnsubscribe,
  onReCenter,
  onVehicleSelect,
  backTitle = 'Back to routes',
}: RouteDetailsProps) => {
  const routeColorMode = useSettingsStore((state) => state.routeColorMode);
  const color = resolveRouteColor({
    routeId: route.gtfsId,
    mode: route.mode ?? 'bus',
    colorMode: routeColorMode,
    isSubscribed,
  });
  const routeLength = patterns && patterns.length > 0 ? calculateRouteLength(patterns) : 0;
  const routeVehicles = vehicles.filter(
    (vehicle) => vehicle.routeId.replace(/^HSL:/, '') === route.gtfsId.replace(/^HSL:/, ''),
  ).sort((a, b) => {
    if (a.direction !== b.direction) return a.direction - b.direction;
    return a.vehicleNumber - b.vehicleNumber;
  });

  return (
    <div className="space-y-3 px-0.5">
      <DetailBackButton label={backTitle} onClick={onBack} />
      <DetailHeader
        badge={<span className="flex h-11 min-w-11 items-center justify-center rounded-xl px-2 font-bold text-white" style={{ backgroundColor: color }}>{route.shortName}</span>}
        title={route.longName || `Route ${route.shortName}`}
        subtitle={<><span className="capitalize">{route.mode ?? 'bus'}</span>{routeLength > 0 && <span>· {formatDistance(routeLength)} route</span>}<span>· {routeVehicles.length} {routeVehicles.length === 1 ? 'vehicle' : 'vehicles'}</span></>}
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={isSubscribed ? onUnsubscribe : onSubscribe} className={detailActionClass}
          aria-label={isSubscribed ? 'Stop tracking route' : 'Track this route'} aria-pressed={isSubscribed}>
          <StarIcon active={isSubscribed} className="h-4 w-4" />{isSubscribed ? 'Tracking' : 'Track route'}
        </button>
        {onReCenter && <button onClick={onReCenter} className={detailActionClass}>Show route on map</button>}
      </div>
      <section aria-label="Route vehicles" className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Live vehicles</h3>
        {[1, 2].map((direction) => {
          const group = routeVehicles.filter((vehicle) => vehicle.direction === direction);
          if (!group.length) return null;
          const destination = group[0].headsign || 'Unknown destination';
          return <div key={direction} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <h4 className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">Towards {destination}</h4>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {group.map((vehicle) => {
                const delayClass = vehicle.delay > DELAY_LATE_THRESHOLD ? 'text-red-600 dark:text-red-400'
                  : vehicle.delay < DELAY_EARLY_THRESHOLD ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300';
                return <button key={vehicle.vehicleId} onClick={() => onVehicleSelect?.(vehicle)} disabled={!onVehicleSelect}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left enabled:hover:bg-gray-50 dark:enabled:hover:bg-gray-800 focus-visible:outline-primary-500">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">Vehicle {vehicle.vehicleNumber}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{vehicle.headsign && vehicle.headsign !== destination ? vehicle.headsign + ' · ' : ''}{formatSpeed(vehicle.speed)}</div>
                  </div>
                  <span className={`text-sm font-medium tabular-nums ${delayClass}`}>{formatDelay(vehicle.delay)}</span>
                  <span aria-hidden="true" className="text-gray-400">›</span>
                </button>;
              })}
            </div>
          </div>;
        })}
        {!routeVehicles.length && <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">No active vehicles for this route right now</p>}
      </section>
    </div>
  );
};
