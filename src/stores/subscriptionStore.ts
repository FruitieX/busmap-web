import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SubscribedRoute, Route, TransportMode, BoundingBox } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import { fetchRoutesByIds } from '@/lib/api';

/**
 * Migrate from the legacy busmap localStorage format (pre-maplibre rewrite).
 *
 * Old format:
 *   - "activeRoutes": JSON string[] of gtfsId values
 *   - "routes": JSON { [gtfsId]: { gtfsId, shortName, longName } }
 *
 * Fetches fresh route data from the API and drops any routes that no longer exist.
 */
const migrateLegacySubscriptions = async (): Promise<SubscribedRoute[] | null> => {
  const raw = localStorage.getItem('activeRoutes');
  if (!raw) return null;

  try {
    const activeRouteIds: string[] = JSON.parse(raw);
    if (!Array.isArray(activeRouteIds) || activeRouteIds.length === 0) {
      removeLegacyKeys();
      return null;
    }

    const validIds = activeRouteIds.filter((id) => typeof id === 'string');
    const routes = await fetchRoutesByIds(validIds);

    const migrated: SubscribedRoute[] = routes.map((route, index) => ({
      gtfsId: route.gtfsId,
      shortName: route.shortName,
      longName: route.longName,
      mode: route.mode ?? inferMode(route.gtfsId),
      color: getRouteColor(route, index, routes.length),
      subscribedAt: Date.now(),
    }));

    removeLegacyKeys();
    return migrated;
  } catch {
    // Don't remove legacy keys on network failure — retry next launch
    return null;
  }
};

const removeLegacyKeys = () => {
  localStorage.removeItem('activeRoutes');
  localStorage.removeItem('routes');
};

interface SubscriptionState {
  // Subscribed routes (for saved mode)
  subscribedRoutes: SubscribedRoute[];

  // Nearby mode bounding box
  nearbyBounds: BoundingBox | null;

  // Actions
  subscribeToRoute: (route: Route) => void;
  unsubscribeFromRoute: (gtfsId: string) => void;
  isSubscribed: (gtfsId: string) => boolean;
  setNearbyBounds: (bounds: BoundingBox | null) => void;
  clearAllSubscriptions: () => void;
}

const inferMode = (gtfsId: string): TransportMode => {
  // HSL route IDs start with HSL: prefix
  const id = gtfsId.replace('HSL:', '');

  // First digit indicates mode:
  // 1xxx = bus, 2xxx = tram, 3xxx = train, 4xxx = metro, 5xxx = ferry (roughly)
  // This is a simplification - real logic would check the API's mode field
  if (id.startsWith('1') || id.startsWith('2') || id.startsWith('4') || id.startsWith('5') || id.startsWith('6') || id.startsWith('7') || id.startsWith('9')) {
    return 'bus';
  }
  if (id.startsWith('10')) return 'tram';
  if (id.startsWith('31')) return 'metro';
  if (id.startsWith('30')) return 'train';
  return 'bus';
};

const getRouteColor = (route: Route, index: number, total: number): string => {
  if (route.color) return route.color;
  if (route.mode) return TRANSPORT_COLORS[route.mode];

  // Generate distinct colors based on index using HSL color wheel
  const hue = (360 * index) / Math.max(6, total);
  return `hsl(${hue}, 70%, 45%)`;
};

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      subscribedRoutes: [],
      nearbyBounds: null,

      subscribeToRoute: (route) => {
        const { subscribedRoutes } = get();

        if (subscribedRoutes.some((r) => r.gtfsId === route.gtfsId)) {
          return; // Already subscribed
        }

        const newRoute: SubscribedRoute = {
          gtfsId: route.gtfsId,
          shortName: route.shortName,
          longName: route.longName,
          mode: route.mode ?? inferMode(route.gtfsId),
          color: getRouteColor(route, subscribedRoutes.length, subscribedRoutes.length + 1),
          subscribedAt: Date.now(),
        };

        set({ subscribedRoutes: [...subscribedRoutes, newRoute] });
      },

      unsubscribeFromRoute: (gtfsId) => {
        set((state) => ({
          subscribedRoutes: state.subscribedRoutes.filter((r) => r.gtfsId !== gtfsId),
        }));
      },

      isSubscribed: (gtfsId) => {
        return get().subscribedRoutes.some((r) => r.gtfsId === gtfsId);
      },

      setNearbyBounds: (nearbyBounds) => set({ nearbyBounds }),

      clearAllSubscriptions: () => set({ subscribedRoutes: [] }),
    }),
    {
      name: 'busmap-subscriptions',
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.subscribedRoutes.length > 0) return;

        migrateLegacySubscriptions().then((migrated) => {
          if (migrated && migrated.length > 0) {
            useSubscriptionStore.setState({ subscribedRoutes: migrated });
          }
        });
      },
    }
  )
);
