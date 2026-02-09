import { create } from 'zustand';
import type { Stop } from '@/types';

interface StopState {
  /** Currently selected stop (from map click or list click) */
  selectedStop: Stop | null;

  /** Route IDs that pass through the selected stop */
  selectedStopRouteIds: Set<string>;

  /** Allowed MQTT direction values per route at the selected stop */
  selectedStopDirections: Record<string, number[]>;

  /** Select a stop and set its route IDs for filtering */
  selectStop: (stop: Stop) => void;

  /** Update direction filtering data (called when timetable loads) */
  setStopDirections: (directions: Record<string, number[]>) => void;

  /** Clear the selected stop */
  clearSelectedStop: () => void;
}

const createStopStore = () => create<StopState>((set) => ({
  selectedStop: null,
  selectedStopRouteIds: new Set(),
  selectedStopDirections: {},

  selectStop: (stop) => {
    const routeIds = new Set(stop.routes.map((r) => r.gtfsId));
    set({ selectedStop: stop, selectedStopRouteIds: routeIds, selectedStopDirections: {} });
  },

  setStopDirections: (directions) => {
    set({ selectedStopDirections: directions });
  },

  clearSelectedStop: () => {
    set({ selectedStop: null, selectedStopRouteIds: new Set(), selectedStopDirections: {} });
  },
}));

type StopStore = ReturnType<typeof createStopStore>;
export const useStopStore: StopStore =
  (import.meta.hot?.data?.useStopStore as StopStore | undefined) ?? createStopStore();

// Preserve store across HMR
if (import.meta.hot) {
  import.meta.hot.data.useStopStore = useStopStore;
}
