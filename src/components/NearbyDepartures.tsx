import { useEffect, useState } from 'react';
import type { Stop } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import { useStopTimetable } from '@/lib';
import { useSubscriptionStore } from '@/stores';

type NearbyStop = Stop & { distance: number };

function StopPreview({ stop, now, onSelect }: { stop: NearbyStop; now: number; onSelect: (stop: Stop) => void }) {
  const { data, isLoading, isError, fetchStatus, dataUpdatedAt } = useStopTimetable(stop.gtfsId);
  const savedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const departures = (data?.departures ?? [])
    .filter((departure) => departure.realtimeState !== 'CANCELED'
      && (departure.serviceDay + departure.realtimeDeparture) * 1000 >= now)
    .sort((a, b) => a.serviceDay + a.realtimeDeparture - b.serviceDay - b.realtimeDeparture)
    .slice(0, 2);
  const unavailable = isError || fetchStatus === 'paused' || now - dataUpdatedAt > 90_000;
  return (
    <button type="button" onClick={() => onSelect(stop)} aria-label={`Departures from ${stop.name}`}
      className="w-full rounded-xl border border-gray-100 p-3 text-left hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-white">{stop.name} <span className="font-normal text-xs text-gray-500">{stop.code}</span></span>
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{Math.round(stop.distance)} m</span>
      </div>
      <div className="mt-2 space-y-1.5 text-sm">
        {departures.map((departure, index) => (
          <div key={`${departure.routeGtfsId}-${index}`} className="flex items-baseline gap-2">
            <span className="min-w-9 rounded px-1.5 py-0.5 text-center text-xs font-bold text-white" style={{ backgroundColor: TRANSPORT_COLORS[departure.routeMode] }}>
              {departure.routeShortName}
            </span>
            <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">{departure.headsign || departure.routeLongName}</span>
            {savedRoutes.some((route) => route.gtfsId === departure.routeGtfsId) && <span className="text-xs text-amber-600 dark:text-amber-400" aria-label="Tracked route">★</span>}
            <span className="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-white">{!departure.realtime ? '≈ ' : ''}{Math.ceil(((departure.serviceDay + departure.realtimeDeparture) * 1000 - now) / 60_000)} min</span>
          </div>
        ))}
        {isLoading ? <p className="text-xs text-gray-500">Loading departures…</p>
          : unavailable ? <p className="text-xs text-amber-700 dark:text-amber-300">{data ? 'Saved times · Updates unavailable' : 'Departures unavailable · Open to retry'}</p>
            : departures.length === 0 ? <p className="text-xs text-gray-500">No upcoming departures</p> : null}
      </div>
    </button>
  );
}

export function NearbyDepartures({ stops, isCurrent, onSelect }: { stops: NearbyStop[]; isCurrent: boolean; onSelect: (stop: Stop) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  if (!stops.length) return null;
  return (
    <section aria-label="Nearby departures" className="mb-5 space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{isCurrent ? 'Departures near you' : 'Near your last location'}</h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Nearest stops · Straight-line distances · ★ Tracked</p>
      </div>
      {stops.slice(0, 3).map((stop) => <StopPreview key={stop.gtfsId} stop={stop} now={now} onSelect={onSelect} />)}
    </section>
  );
}
