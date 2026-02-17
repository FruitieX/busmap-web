import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Settings, MapStyle, RouteColorMode } from '@/types';

interface SettingsState extends Settings {
  setShowNearby: (show: boolean) => void;
  toggleNearby: () => void;
  setNearbyRadius: (radius: number) => void;
  setLocationRadius: (radius: number) => void;
  setMarkerSizeLevel: (level: 1 | 2 | 3 | 4 | 5) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setMapStyle: (style: MapStyle) => void;
  setShowRouteLines: (show: boolean) => void;
  setShowStops: (show: boolean) => void;
  setShowNearbyRoutes: (show: boolean) => void;
  setRouteColorMode: (mode: RouteColorMode) => void;
  setAnimateVehicles: (animate: boolean) => void;
  setShowVehicleTerminusLabel: (show: boolean) => void;
  setDeveloperMode: (enabled: boolean) => void;
  setSheetHeight: (height: number) => void;
  reset: () => void;
}

const defaultSettings: Settings = {
  showNearby: false,
  nearbyRadius: 1000,
  locationRadius: 1000,
  markerSizeLevel: 3,
  theme: 'system',
  mapStyle: 'voyager',
  showRouteLines: true,
  showStops: false,
  showNearbyRoutes: false,
  routeColorMode: 'off',
  animateVehicles: true,
  showVehicleTerminusLabel: true,
  developerMode: false,
  sheetHeight: 340,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setShowNearby: (showNearby) => set({ showNearby }),
      toggleNearby: () => set((state) => ({ showNearby: !state.showNearby })),
      setNearbyRadius: (nearbyRadius) => set({ nearbyRadius }),
      setLocationRadius: (locationRadius) => set({ locationRadius }),
      setMarkerSizeLevel: (markerSizeLevel) => set({ markerSizeLevel }),
      setTheme: (theme) => set({ theme }),
      setMapStyle: (mapStyle) => set({ mapStyle }),
      setShowRouteLines: (showRouteLines) => set({ showRouteLines }),
      setShowStops: (showStops) => set({ showStops }),
      setShowNearbyRoutes: (showNearbyRoutes) => set({ showNearbyRoutes }),
      setRouteColorMode: (routeColorMode) => set({ routeColorMode }),
      setAnimateVehicles: (animateVehicles) => set({ animateVehicles }),
      setShowVehicleTerminusLabel: (showVehicleTerminusLabel) => set({ showVehicleTerminusLabel }),
      setDeveloperMode: (developerMode) => set({ developerMode }),
      setSheetHeight: (sheetHeight) => set({ sheetHeight }),
      reset: () => set(defaultSettings),
    }),
    {
      name: 'busmap-settings',
      version: 10,
      migrate: (persisted, version) => {
        console.log(`[busmap] Migrating settings from version ${version} to 10`, persisted);
        const migrated = { ...defaultSettings, ...(persisted as object) };
        console.log('[busmap] Migrated settings:', migrated);
        return migrated;
      },
    }
  )
);
