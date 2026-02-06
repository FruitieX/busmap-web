import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Settings, MapStyle } from '@/types';

interface SettingsState extends Settings {
  setShowNearby: (show: boolean) => void;
  toggleNearby: () => void;
  setNearbyRadius: (radius: number) => void;
  setLocationRadius: (radius: number) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setMapStyle: (style: MapStyle) => void;
  setShowRouteLines: (show: boolean) => void;
  setAnimateVehicles: (animate: boolean) => void;
  setDeveloperMode: (enabled: boolean) => void;
  reset: () => void;
}

const defaultSettings: Settings = {
  showNearby: false,
  nearbyRadius: 1000,
  locationRadius: 1000,
  theme: 'system',
  mapStyle: 'voyager',
  showRouteLines: true,
  animateVehicles: true,
  developerMode: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setShowNearby: (showNearby) => set({ showNearby }),
      toggleNearby: () => set((state) => ({ showNearby: !state.showNearby })),
      setNearbyRadius: (nearbyRadius) => set({ nearbyRadius }),
      setLocationRadius: (locationRadius) => set({ locationRadius }),
      setTheme: (theme) => set({ theme }),
      setMapStyle: (mapStyle) => set({ mapStyle }),
      setShowRouteLines: (showRouteLines) => set({ showRouteLines }),
      setAnimateVehicles: (animateVehicles) => set({ animateVehicles }),
      setDeveloperMode: (developerMode) => set({ developerMode }),
      reset: () => set(defaultSettings),
    }),
    {
      name: 'busmap-settings',
      version: 5,
    }
  )
);
