import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SubscribedRoute, Route, TransportMode, BoundingBox } from '@/types';
import { TRANSPORT_COLORS } from '@/types';

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
    }
  )
);
