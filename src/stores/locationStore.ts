import { create } from 'zustand';
import type { UserLocation, MapViewport } from '@/types';

// Default viewport centered on Helsinki
const DEFAULT_VIEWPORT: MapViewport = {
  latitude: 60.17,
  longitude: 24.94,
  zoom: 14,
  bearing: 0,
  pitch: 0,
};

interface LocationState {
  userLocation: UserLocation | null;
  locationError: string | null;
  isLocating: boolean;
  viewport: MapViewport;
  pendingFlyTo: { latitude: number; longitude: number; zoom: number; bearing?: number; pitch?: number } | null;

  setUserLocation: (location: UserLocation) => void;
  setLocationError: (error: string | null) => void;
  setIsLocating: (isLocating: boolean) => void;
  setViewport: (viewport: Partial<MapViewport>) => void;
  flyToLocation: (lat: number, lng: number, zoom?: number) => void;
  flyToUserLocation: () => void;
  consumePendingFlyTo: () => void;
  resetViewport: () => void;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  userLocation: null,
  locationError: null,
  isLocating: false,
  viewport: DEFAULT_VIEWPORT,
  pendingFlyTo: null,

  setUserLocation: (userLocation) => set({ userLocation, locationError: null }),
  setLocationError: (locationError) => set({ locationError, isLocating: false }),
  setIsLocating: (isLocating) => set({ isLocating }),

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
      return { viewport: { ...state.viewport, ...validated } };
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
    const { userLocation } = get();

    const doFlyTo = (loc: UserLocation) => {
      set({
        pendingFlyTo: {
          latitude: loc.latitude,
          longitude: loc.longitude,
          zoom: 15,
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
// Location Tracker - handles watchPosition + polling fallback
// ============================================================================

interface TrackerState {
  watchId: number | null;
  lastUpdateTime: number;
  consecutiveErrors: number;
  useHighAccuracy: boolean;
  isActive: boolean;
  pollIntervalId: ReturnType<typeof setInterval> | null;
  interactionListenerActive: boolean;
}

const state: TrackerState = {
  watchId: null,
  lastUpdateTime: 0,
  consecutiveErrors: 0,
  useHighAccuracy: true,
  isActive: false,
  pollIntervalId: null,
  interactionListenerActive: false,
};

// How long without updates before we consider the watcher stale
const STALE_THRESHOLD_MS = 30_000;
// How often to poll as a fallback
const POLL_INTERVAL_MS = 15_000;
// How often to poll when there's been recent interaction
const INTERACTION_POLL_DELAY_MS = 100;

const updateLocation = (position: GeolocationPosition) => {
  state.lastUpdateTime = Date.now();
  state.consecutiveErrors = 0;
  useLocationStore.getState().setUserLocation({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: position.timestamp,
  });
};

const handleWatchError = (error: GeolocationPositionError) => {
  console.warn('Location watch error:', error.message, `(code: ${error.code})`);
  state.consecutiveErrors++;

  if (error.code === error.PERMISSION_DENIED) {
    useLocationStore.getState().setLocationError('Location permission denied');
    stopWatchingLocation();
    return;
  }

  // After consecutive errors with high accuracy, try low accuracy
  if (state.consecutiveErrors >= 2 && state.useHighAccuracy) {
    console.warn('Switching to low accuracy mode after errors');
    state.useHighAccuracy = false;
    restartWatcher();
  }
};

const startWatcher = () => {
  if (state.watchId !== null || !navigator.geolocation) return;

  state.watchId = navigator.geolocation.watchPosition(
    (position) => {
      // If we were in low accuracy and got a successful update, try switching back
      if (!state.useHighAccuracy && state.consecutiveErrors === 0) {
        state.useHighAccuracy = true;
        restartWatcher();
        return;
      }
      updateLocation(position);
    },
    handleWatchError,
    {
      enableHighAccuracy: state.useHighAccuracy,
      timeout: state.useHighAccuracy ? 15_000 : 30_000,
      maximumAge: 10_000,
    },
  );
};

const stopWatcher = () => {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
};

const restartWatcher = () => {
  stopWatcher();
  startWatcher();
};

const pollLocation = () => {
  if (!navigator.geolocation || !state.isActive) return;

  const timeSinceUpdate = Date.now() - state.lastUpdateTime;
  const isStale = timeSinceUpdate > STALE_THRESHOLD_MS;

  // Only actively poll if watcher appears stale
  if (!isStale) return;

  console.debug('Location watcher appears stale, polling with getCurrentPosition');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      updateLocation(position);
      // Watcher might have recovered, restart it
      if (state.watchId !== null) {
        console.debug('Got poll response, restarting watcher');
        state.useHighAccuracy = true;
        state.consecutiveErrors = 0;
        restartWatcher();
      }
    },
    (error) => {
      console.warn('Poll getCurrentPosition failed:', error.message);
      // If high accuracy polling fails, try low accuracy
      if (state.useHighAccuracy) {
        state.useHighAccuracy = false;
        restartWatcher();
      }
    },
    {
      enableHighAccuracy: state.useHighAccuracy,
      timeout: state.useHighAccuracy ? 10_000 : 20_000,
      maximumAge: 30_000,
    },
  );
};

const startPolling = () => {
  if (state.pollIntervalId !== null) return;
  state.pollIntervalId = setInterval(pollLocation, POLL_INTERVAL_MS);
};

const stopPolling = () => {
  if (state.pollIntervalId !== null) {
    clearInterval(state.pollIntervalId);
    state.pollIntervalId = null;
  }
};

// Debounced interaction handler to avoid excessive polling
let interactionTimeout: ReturnType<typeof setTimeout> | null = null;

const handleInteraction = () => {
  if (!state.isActive) return;

  // Debounce: only trigger once per interaction burst
  if (interactionTimeout !== null) return;

  interactionTimeout = setTimeout(() => {
    interactionTimeout = null;

    const timeSinceUpdate = Date.now() - state.lastUpdateTime;
    if (timeSinceUpdate > STALE_THRESHOLD_MS) {
      console.debug('User interaction detected, triggering location poll');
      pollLocation();
    }
  }, INTERACTION_POLL_DELAY_MS);
};

const addInteractionListeners = () => {
  if (state.interactionListenerActive) return;
  state.interactionListenerActive = true;

  // Use capture phase to detect interactions early
  document.addEventListener('pointerdown', handleInteraction, { capture: true, passive: true });
  document.addEventListener('touchstart', handleInteraction, { capture: true, passive: true });
  document.addEventListener('wheel', handleInteraction, { capture: true, passive: true });
  document.addEventListener('keydown', handleInteraction, { capture: true, passive: true });
};

const removeInteractionListeners = () => {
  if (!state.interactionListenerActive) return;
  state.interactionListenerActive = false;

  document.removeEventListener('pointerdown', handleInteraction, { capture: true });
  document.removeEventListener('touchstart', handleInteraction, { capture: true });
  document.removeEventListener('wheel', handleInteraction, { capture: true });
  document.removeEventListener('keydown', handleInteraction, { capture: true });
};

const handleVisibilityChange = () => {
  if (!state.isActive) return;

  if (document.visibilityState === 'visible') {
    console.debug('Page became visible, refreshing location tracking');
    state.consecutiveErrors = 0;
    state.useHighAccuracy = true;
    state.lastUpdateTime = Date.now();
    restartWatcher();
    // Also do an immediate poll in case watcher is slow to respond
    setTimeout(pollLocation, 500);
  }
};

const handlePageShow = (event: PageTransitionEvent) => {
  // bfcache restoration - page was restored from back/forward cache
  if (event.persisted && state.isActive) {
    console.debug('Page restored from bfcache, restarting location tracking');
    state.consecutiveErrors = 0;
    state.useHighAccuracy = true;
    state.lastUpdateTime = Date.now();
    restartWatcher();
    setTimeout(pollLocation, 500);
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

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location: UserLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };
        useLocationStore.getState().setUserLocation(location);
        useLocationStore.getState().setIsLocating(false);
        state.lastUpdateTime = Date.now();
        state.useHighAccuracy = true;
        resolve(location);
      },
      (error) => {
        useLocationStore.getState().setIsLocating(false);
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied'
            : error.code === error.POSITION_UNAVAILABLE
              ? 'Location unavailable'
              : 'Location request timed out';
        useLocationStore.getState().setLocationError(message);
        reject(new Error(message));
      },
      {
        enableHighAccuracy: state.useHighAccuracy,
        timeout: state.useHighAccuracy ? 10_000 : 20_000,
        maximumAge: 60_000,
      },
    );
  });
};

export const watchUserLocation = () => {
  if (state.isActive) return;
  state.isActive = true;

  state.lastUpdateTime = Date.now();
  state.consecutiveErrors = 0;
  state.useHighAccuracy = true;

  startWatcher();
  startPolling();
  addInteractionListeners();

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pageshow', handlePageShow);
};

export const stopWatchingLocation = () => {
  if (!state.isActive) return;
  state.isActive = false;

  stopWatcher();
  stopPolling();
  removeInteractionListeners();

  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('pageshow', handlePageShow);

  if (interactionTimeout !== null) {
    clearTimeout(interactionTimeout);
    interactionTimeout = null;
  }
};
