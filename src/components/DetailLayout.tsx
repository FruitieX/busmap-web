import type { ReactNode } from 'react';
import { useLocationStore } from '@/stores';
import { haversineDistance } from '@/lib';

export const detailActionClass = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';

export function DetailHeader({ badge, title, subtitle }: { badge: ReactNode; title: string; subtitle: ReactNode }) {
  return (
    <header className="flex items-start gap-3">
      <div className="shrink-0 pt-0.5">{badge}</div>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold leading-tight tracking-tight text-gray-900 dark:text-white break-words">{title}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>
      </div>
    </header>
  );
}

export function DistanceFromYou({ lat, lon }: { lat: number; lon: number }) {
  const location = useLocationStore((state) => state.userLocation);
  if (!location) return null;
  const distance = haversineDistance(location.latitude, location.longitude, lat, lon);
  return <span title="Straight-line distance, not a walking route">{distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`} from you</span>;
}
