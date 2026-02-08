import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SubscribedStop, Stop } from '@/types';

interface SubscribedStopState {
  subscribedStops: SubscribedStop[];

  subscribeToStop: (stop: Stop) => void;
  unsubscribeFromStop: (gtfsId: string) => void;
  isStopSubscribed: (gtfsId: string) => boolean;
  clearAllStops: () => void;
}

export const useSubscribedStopStore = create<SubscribedStopState>()(
  persist(
    (set, get) => ({
      subscribedStops: [],

      subscribeToStop: (stop) => {
        const { subscribedStops } = get();

        if (subscribedStops.some((s) => s.gtfsId === stop.gtfsId)) {
          return; // Already subscribed
        }

        const newStop: SubscribedStop = {
          gtfsId: stop.gtfsId,
          name: stop.name,
          code: stop.code,
          lat: stop.lat,
          lon: stop.lon,
          vehicleMode: stop.vehicleMode,
          subscribedAt: Date.now(),
        };

        set({ subscribedStops: [...subscribedStops, newStop] });
      },

      unsubscribeFromStop: (gtfsId) => {
        set((state) => ({
          subscribedStops: state.subscribedStops.filter((s) => s.gtfsId !== gtfsId),
        }));
      },

      isStopSubscribed: (gtfsId) => {
        return get().subscribedStops.some((s) => s.gtfsId === gtfsId);
      },

      clearAllStops: () => set({ subscribedStops: [] }),
    }),
    {
      name: 'busmap-subscribed-stops',
      version: 1,
      migrate: (persisted, version) => {
        console.log(`[busmap] Migrating subscribed stops from version ${version} to 1`, persisted);
        return { subscribedStops: [], ...(persisted as object) };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.subscribedStops.length > 0) {
          console.log(`[busmap] Rehydrated ${state.subscribedStops.length} subscribed stops from storage`);
        }
      },
    },
  ),
);
