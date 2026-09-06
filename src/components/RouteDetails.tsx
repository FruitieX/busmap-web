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
    (vehicle) => vehicle.routeId === route.gtfsId.replace('HSL:', '') || vehicle.routeShortName === route.shortName,
  ).sort((a, b) => {
    if (a.direction !== b.direction) return a.direction - b.direction;
    return a.vehicleNumber - b.vehicleNumber;
  });

  return (
    <div className="space-y-3 px-0.5">
      <DetailBackButton label={backTitle} onClick={onBack} />
      <div className="flex items-center gap-3">

        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
          style={{ backgroundColor: color }}
        >
          {route.shortName}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 dark:text-white line-clamp-2 leading-5" title={route.longName || `Route ${route.shortName}`}>
            {route.longName || `Route ${route.shortName}`}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">
            {route.mode ?? 'bus'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2">
          <div className="text-lg font-semibold text-gray-900 dark:text-white">{routeVehicles.length}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">Vehicles</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2">
          <div className="text-lg font-semibold text-gray-900 dark:text-white">
            {routeLength > 0 ? formatDistance(routeLength) : '-'}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">Length</div>
        </div>
      </div>

      <div className="flex gap-2">
        {onReCenter && (
          <button
            onClick={onReCenter}
            className="py-2 px-3 rounded-lg text-sm font-medium transition-colors bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            title="Re-center on route"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        )}
        <button
          onClick={isSubscribed ? onUnsubscribe : onSubscribe}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            isSubscribed
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              : 'text-white hover:opacity-90'
          }`}
          style={!isSubscribed ? { backgroundColor: color } : undefined}
        >
          <StarIcon active={isSubscribed} className="w-4 h-4" />
          {isSubscribed ? 'Stop tracking route' : 'Track this route'}
        </button>
      </div>

      <div className="pt-1">
        <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">Vehicles</h3>
        {routeVehicles.length > 0 ? (
          <div className="space-y-2">
            {routeVehicles.map((vehicle) => {
              const delayClass =
                vehicle.delay > DELAY_LATE_THRESHOLD
                  ? 'text-red-500'
                  : vehicle.delay < DELAY_EARLY_THRESHOLD
                    ? 'text-green-500'
                    : 'text-gray-500 dark:text-gray-400';

              return (
                <button
                  key={vehicle.vehicleId}
                  className="w-full text-left bg-gray-50 dark:bg-gray-800 rounded-xl p-2 min-[425px]:p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  onClick={() => onVehicleSelect?.(vehicle)}
                >
                  <div
                    className="w-10 h-10 min-[425px]:w-12 min-[425px]:h-12 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    {vehicle.routeShortName}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white truncate">
                      {vehicle.headsign || route.longName || 'Unknown destination'}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={delayClass}>{formatDelay(vehicle.delay)}</span>
                      <span className="text-gray-400">•</span>
                      <span className="text-gray-500 dark:text-gray-400">{formatSpeed(vehicle.speed)}</span>
                      <span className="text-gray-400">•</span>
                      <span className="text-gray-500 dark:text-gray-400">Vehicle {vehicle.vehicleNumber}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-sm text-gray-500 dark:text-gray-400 text-center">
            No active vehicles for this route right now
          </div>
        )}
      </div>
    </div>
  );
};
