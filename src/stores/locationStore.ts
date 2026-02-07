import { create } from 'zustand';
import type { UserLocation, MapViewport } from '@/types';
import { useSettingsStore } from './settingsStore';

import { SHEET_DEFAULT_HEIGHT, TOP_BAR_HEIGHT, METERS_PER_DEGREE_LAT } from '@/constants';

const LAST_LOCATION_KEY = 'busmap-last-location';

const loadLastLocation = (): { latitude: number; longitude: number } | null => {
  try {
    const stored = localStorage.getItem(LAST_LOCATION_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (isFinite(parsed.latitude) && isFinite(parsed.longitude)) return parsed;
  } catch { /* ignore */ }
  return null;
};

const saveLastLocation = (latitude: number, longitude: number) => {
  localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ latitude, longitude }));
};

/** Convert a radius in meters to a map zoom level that fits the circle on screen. */
export const radiusToZoom = (radiusMeters: number, latitude: number, bottomPadding = 0): number => {
  const earthCircumference = 40075016.686;
  // MapLibre uses 512px tiles
  const metersPerPixelAtZoom0 = earthCircumference * Math.cos(latitude * Math.PI / 180) / 512;
  const availableHeight = window.innerHeight - bottomPadding - TOP_BAR_HEIGHT;
  const halfScreen = Math.min(window.innerWidth, availableHeight) / 2;
  const metersPerPixel = radiusMeters / halfScreen;
  return Math.log2(metersPerPixelAtZoom0 / metersPerPixel);
};

/** Offset latitude so the target point appears at the center of visible area (accounting for top/bottom padding). */
const offsetLatForPadding = (latitude: number, zoom: number, topPadding: number, bottomPadding: number): number => {
  const pixelOffset = (bottomPadding - topPadding) / 2;
  const earthCircumference = 40075016.686;
  const metersPerPixel = earthCircumference * Math.cos(latitude * Math.PI / 180) / (512 * Math.pow(2, zoom));
  return latitude - (pixelOffset * metersPerPixel) / METERS_PER_DEGREE_LAT;
};

// Default viewport restored from last user location, or Helsinki as fallback
const lastLocation = loadLastLocation();
const defaultLat = lastLocation?.latitude ?? 60.17;
const defaultLng = lastLocation?.longitude ?? 24.94;
const defaultZoom = radiusToZoom(useSettingsStore.getState().locationRadius, defaultLat, SHEET_DEFAULT_HEIGHT);
const DEFAULT_VIEWPORT: MapViewport = {
  latitude: offsetLatForPadding(defaultLat, defaultZoom, TOP_BAR_HEIGHT, SHEET_DEFAULT_HEIGHT),
  longitude: defaultLng,
  zoom: defaultZoom,
  bearing: 0,
  pitch: 0,
};

interface LocationState {
  userLocation: UserLocation | null;
  lastKnownLocation: { latitude: number; longitude: number } | null;
  locationError: string | null;
  isLocating: boolean;
  viewport: MapViewport;
  bottomPadding: number;
  pendingFlyTo: { latitude: number; longitude: number; zoom: number; bearing?: number; pitch?: number } | null;

  setUserLocation: (location: UserLocation) => void;
  setLocationError: (error: string | null) => void;
  setIsLocating: (isLocating: boolean) => void;
  setViewport: (viewport: Partial<MapViewport>) => void;
  setBottomPadding: (padding: number) => void;
  flyToLocation: (lat: number, lng: number, zoom?: number) => void;
  flyToUserLocation: () => void;
  consumePendingFlyTo: () => void;
  resetViewport: () => void;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  userLocation: null,
  lastKnownLocation: lastLocation,
  locationError: null,
  isLocating: false,
  viewport: DEFAULT_VIEWPORT,
  bottomPadding: SHEET_DEFAULT_HEIGHT,
  pendingFlyTo: null,

  setUserLocation: (userLocation) => {
    saveLastLocation(userLocation.latitude, userLocation.longitude);
    set({ userLocation, locationError: null });
  },
  setLocationError: (locationError) => set({ locationError, isLocating: false }),
  setIsLocating: (isLocating) => set({ isLocating }),
  setBottomPadding: (bottomPadding) => set({ bottomPadding }),

  setViewport: (partial) =>
    set((state) => {
      const validated: Partial<MapViewport> = {};
      if (partial.latitude !== undefined && isFinite(partial.latitude)) {
        validated.latitude = partial.latitude;
      }
      if (partial.longitude !== undefined && isFinite(partial.longitude)) {
        validated.longitude = partial.longitude;
      }
      if (partial.zoom !== undefined && isFinite(partial.zoom)) {
        validated.zoom = Math.max(0, Math.min(24, partial.zoom));
      }
      if (partial.bearing !== undefined && isFinite(partial.bearing)) {
        validated.bearing = partial.bearing;
      }
      if (partial.pitch !== undefined && isFinite(partial.pitch)) {
        validated.pitch = Math.max(0, Math.min(85, partial.pitch));
      }
      const newViewport = { ...state.viewport, ...validated };
      return { viewport: newViewport };
    }),

  flyToLocation: (latitude, longitude, zoom) => {
    const currentZoom = get().viewport.zoom;
    const clampedZoom = Math.max(0, Math.min(24, zoom ?? currentZoom));
    if (!isFinite(latitude) || !isFinite(longitude) || !isFinite(clampedZoom)) {
      console.warn('Invalid flyToLocation params:', { latitude, longitude, zoom });
      return;
    }
    set({ pendingFlyTo: { latitude, longitude, zoom: clampedZoom } });
  },

  flyToUserLocation: () => {
    const { userLocation, bottomPadding } = get();
    const { locationRadius } = useSettingsStore.getState();

    const doFlyTo = (loc: UserLocation) => {
      set({
        pendingFlyTo: {
          latitude: loc.latitude,
          longitude: loc.longitude,
          zoom: radiusToZoom(locationRadius, loc.latitude, bottomPadding),
          bearing: 0,
          pitch: 0,
        },
      });
    };

    if (userLocation) {
      doFlyTo(userLocation);
    }

    requestUserLocation()
      .then((freshLoc) => {
        if (userLocation) {
          const latDiff = Math.abs(freshLoc.latitude - userLocation.latitude);
          const lonDiff = Math.abs(freshLoc.longitude - userLocation.longitude);
          if (latDiff > 0.0005 || lonDiff > 0.0005) {
            doFlyTo(freshLoc);
          }
        } else {
          doFlyTo(freshLoc);
        }
      })
      .catch((err) => {
        console.warn('Failed to get fresh location:', err);
      });
  },

  consumePendingFlyTo: () => set({ pendingFlyTo: null }),
  resetViewport: () => set({ viewport: DEFAULT_VIEWPORT }),
}));

// ============================================================================
// Location tracking
// ============================================================================

let watchId: number | null = null;
let highAccuracy = false;

const positionToLocation = (position: GeolocationPosition): UserLocation => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  accuracy: position.coords.accuracy,
  timestamp: position.timestamp,
});

const updateLocation = (position: GeolocationPosition) => {
  useLocationStore.getState().setUserLocation(positionToLocation(position));
};

const startWatcher = () => {
  if (watchId !== null || !navigator.geolocation) return;

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      updateLocation(position);

      // After first low-accuracy fix, upgrade to high accuracy
      if (!highAccuracy) {
        highAccuracy = true;
        restartWatcher();
      }
    },
    (error) => {
      console.warn('Location watch error:', error.message);

      if (error.code === error.PERMISSION_DENIED) {
        useLocationStore.getState().setLocationError('Location permission denied');
        stopWatchingLocation();
        return;
      }

      // If high accuracy fails, fall back to low accuracy
      if (highAccuracy) {
        highAccuracy = false;
        restartWatcher();
      }
    },
    {
      enableHighAccuracy: highAccuracy,
      timeout: highAccuracy ? 15_000 : 10_000,
      maximumAge: highAccuracy ? 10_000 : 300_000,
    },
  );
};

const stopWatcher = () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
};

const restartWatcher = () => {
  stopWatcher();
  startWatcher();
};

const handleVisibilityChange = () => {
  if (watchId === null) return;

  if (document.visibilityState === 'visible') {
    highAccuracy = false;
    restartWatcher();
  }
};

// ============================================================================
// Public API
// ============================================================================

export const requestUserLocation = (): Promise<UserLocation> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported'));
      return;
    }

    useLocationStore.getState().setIsLocating(true);

    let resolved = false;

    const finish = (location: UserLocation) => {
      useLocationStore.getState().setUserLocation(location);
      if (!resolved) {
        resolved = true;
        useLocationStore.getState().setIsLocating(false);
        resolve(location);
      }
    };

    const fail = (error: GeolocationPositionError) => {
      if (resolved) return;
      resolved = true;
      useLocationStore.getState().setIsLocating(false);
      const message =
        error.code === error.PERMISSION_DENIED
          ? 'Location permission denied'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'Location unavailable'
            : 'Location request timed out';
      useLocationStore.getState().setLocationError(message);
      reject(new Error(message));
    };

    // Low accuracy first (fast, often cached), then refine with high accuracy
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        finish(positionToLocation(pos));
        navigator.geolocation.getCurrentPosition(
          (precise) => finish(positionToLocation(precise)),
          () => {},
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
        );
      },
      () => {
        // Low accuracy failed, fall back to high accuracy
        navigator.geolocation.getCurrentPosition(
          (pos) => finish(positionToLocation(pos)),
          fail,
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
        );
      },
      { enableHighAccuracy: false, timeout: 5_000, maximumAge: 300_000 },
    );
  });
};

export const watchUserLocation = () => {
  if (watchId !== null) return;

  highAccuracy = false;
  startWatcher();
  document.addEventListener('visibilitychange', handleVisibilityChange);
};

export const stopWatchingLocation = () => {
  stopWatcher();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
};
