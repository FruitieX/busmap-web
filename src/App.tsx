import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { radiusToZoom } from './stores/locationStore';
import { motion, AnimatePresence, useMotionValue, useTransform, type MotionValue } from 'framer-motion';
import {
  BusMap,
  VehicleList,
  VehicleDetails,
  RouteDetails,
  NearbyStops,
  NearbyDepartures,
  StopDetails,
  BottomSheet,
  StatusBar,
  FloatingActionButton,
  SettingsPanel,
  UpdateToast,
  StarToggleButton,
} from '@/components';
import {
  useSettingsStore,
  useSubscriptionStore,
  useLocationStore,
  useVehicleStore,
  useStopStore,
  requestUserLocation,
  watchUserLocation,
} from '@/stores';
import { findMatchingVehicle, haversineDistance, mqttService, resolveRouteColor, useRoutePatterns, useStops } from '@/lib';
import type { Route, TrackedVehicle, BoundingBox, SubscribedRoute, Stop, StopDeparture } from '@/types';
import {
  SHEET_MIN_HEIGHT,
  SHEET_MAX_HEIGHT,
  SHEET_EXPAND_THRESHOLD,
  VEHICLE_FLY_TO_ZOOM,
} from '@/constants';


const SettingsIcon = () => (
  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-full h-full">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const LocationIcon = () => (
  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-full h-full">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);



type SheetTab = 'vehicles' | 'routes' | 'stops';

type SheetHistoryEntry =
  | { tab: 'vehicles'; vehicleId: string | null; stop: Stop | null }
  | { tab: 'routes'; routeId: string; route: Route | SubscribedRoute | null }
  | { tab: 'stops'; stop: Stop };

interface SheetNavigationOptions {
  preserveHistory?: boolean;
}

interface MapCameraActions {
  refollowVehicle: () => void;
  recenterRoute: () => void;
  recenterStop: () => void;
}

interface MapCameraState {
  isFollowingVehicle: boolean;
  hasMovedFromRoute: boolean;
  hasMovedFromStop: boolean;
}

const isSameSheetHistoryEntry = (a: SheetHistoryEntry, b: SheetHistoryEntry): boolean => {
  if (a.tab !== b.tab) return false;
  if (a.tab === 'vehicles' && b.tab === 'vehicles') return a.vehicleId === b.vehicleId;
  if (a.tab === 'routes' && b.tab === 'routes') return a.routeId === b.routeId;
  if (a.tab === 'stops' && b.tab === 'stops') return a.stop.gtfsId === b.stop.gtfsId;
  return true;
};

const TAB_STORAGE_KEY = 'busmap-active-tab';

type StopWithOptionalDistance = Stop & { distance?: number };
type StopWithDistance = Stop & { distance: number };

const hasStopDistance = (stop: StopWithOptionalDistance): stop is StopWithDistance => typeof stop.distance === 'number';

const compareStopsByDistanceThenName = (a: StopWithOptionalDistance, b: StopWithOptionalDistance) => {
  const distanceDiff = (a.distance ?? Infinity) - (b.distance ?? Infinity);
  if (distanceDiff !== 0) return distanceDiff;

  const codeCompare = a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
  if (codeCompare !== 0) return codeCompare;

  return a.name.localeCompare(b.name);
};

const loadSavedTab = (): SheetTab => {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (saved === 'vehicles' || saved === 'routes' || saved === 'stops') return saved;
  } catch { /* ignore */ }
  return 'vehicles';
};

const saveTab = (tab: SheetTab) => {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch { /* ignore */ }
};

const App = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SheetTab>(loadSavedTab);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [activatedRoute, setActivatedRoute] = useState<Route | null>(null);
  const [sheetHeight, setSheetHeight] = useState(() => useSettingsStore.getState().sheetHeight);
  const setPersistedSheetHeight = useSettingsStore((state) => state.setSheetHeight);
  const sheetPersistTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [nearbyMenuOpen, setNearbyMenuOpen] = useState(false);
  const nearbyMenuRef = useRef<HTMLDivElement>(null);
  const nearbyBtnRef = useRef<HTMLButtonElement>(null);
  const [nearbyMenuRect, setNearbyMenuRect] = useState<{ top: number; right: number; above: boolean } | null>(null);
  const [mapCameraActions, setMapCameraActions] = useState<MapCameraActions | null>(null);
  const [mapCameraState, setMapCameraState] = useState<MapCameraState>({
    isFollowingVehicle: true,
    hasMovedFromRoute: false,
    hasMovedFromStop: false,
  });
  const expandSheetRef = useRef<(() => void) | null>(null);
  const sheetContentRef = useRef<HTMLDivElement>(null);
  const stopListScrollRef = useRef(0);
  const sheetHistoryRef = useRef<SheetHistoryEntry[]>([]);

  // Motion-value-driven button position (no React re-render lag)
  const fallbackHeight = useMotionValue(sheetHeight);
  const sheetHeightMV = useRef<MotionValue<number>>(fallbackHeight);
  const handleHeightMV = useCallback((mv: MotionValue<number>) => { sheetHeightMV.current = mv; }, []);
  const fabBottom = useTransform(sheetHeightMV.current, (h: number) => h + 16);

  const switchTab = useCallback((tab: SheetTab) => {
    if (sheetHeight < SHEET_EXPAND_THRESHOLD) {
      expandSheetRef.current?.();
      requestAnimationFrame(() => {
        setActiveTab(tab);
        saveTab(tab);
      });
    } else {
      setActiveTab(tab);
      saveTab(tab);
    }
  }, [sheetHeight]);

  const showSheetTab = useCallback((tab: SheetTab) => {
    switchTab(tab);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (sheetContentRef.current) {
          sheetContentRef.current.scrollTop = 0;
        }
      });
    });
  }, [switchTab]);

  const showNearby = useSettingsStore((state) => state.showNearby);
  const nearbyRadius = useSettingsStore((state) => state.nearbyRadius);
  const setNearbyRadius = useSettingsStore((state) => state.setNearbyRadius);
  const setShowNearby = useSettingsStore((state) => state.setShowNearby);
  const showStops = useSettingsStore((state) => state.showStops);
  const setShowStops = useSettingsStore((state) => state.setShowStops);
  const showNearbyRoutes = useSettingsStore((state) => state.showNearbyRoutes);
  const setShowNearbyRoutes = useSettingsStore((state) => state.setShowNearbyRoutes);
  const routeColorMode = useSettingsStore((state) => state.routeColorMode);
  const anyNearbyActive = showNearby || showNearbyRoutes || showStops;

  // Debounce nearby radius changes (wait 500ms after user stops sliding)
  const [debouncedRadius, setDebouncedRadius] = useState(nearbyRadius);
  const radiusTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    radiusTimeoutRef.current = setTimeout(() => {
      setDebouncedRadius(nearbyRadius);
    }, 500);
    return () => clearTimeout(radiusTimeoutRef.current);
  }, [nearbyRadius]);
  const theme = useSettingsStore((state) => state.theme);
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const vehiclesMap = useVehicleStore((state) => state.vehicles);
  const vehicles = useMemo(() => Array.from(vehiclesMap.values()), [vehiclesMap]);
  const selectedVehicle = selectedVehicleId ? vehiclesMap.get(selectedVehicleId) ?? null : null;
  const selectedVehicleRouteId = selectedVehicle?.routeId;
  const previousView = sheetHistoryRef.current.at(-1);
  const previousViewLabel = previousView?.tab === 'vehicles'
    ? previousView.vehicleId ? `Back to vehicle ${vehiclesMap.get(previousView.vehicleId)?.routeShortName ?? ''}`.trim() : 'Back to nearby departures'
    : previousView?.tab === 'routes'
      ? `Back to route ${previousView.route?.shortName ?? previousView.routeId.replace('HSL:', '')}`
      : previousView?.tab === 'stops' ? `Back to ${previousView.stop.name}` : null;
  const { subscribeToRoute, unsubscribeFromRoute } = useSubscriptionStore();
  const flyToUserLocation = useLocationStore((state) => state.flyToUserLocation);
  const setBottomPadding = useLocationStore((state) => state.setBottomPadding);

  // Stops store
  const { selectedStop, selectedStopRouteIds, selectStop, clearSelectedStop } = useStopStore();

  // Temporary MQTT subscriptions for activated (not permanently subscribed) routes
  const tempMqttRouteIds = useRef(new Set<string>());

  // Nearby route MQTT subscriptions (managed separately from temp subscriptions)
  const nearbyMqttRouteIds = useRef(new Set<string>());

  // Clean up temporary MQTT subscriptions that aren't permanently subscribed
  const cleanupTempSubscriptions = useCallback(() => {
    const permanentIds = new Set(useSubscriptionStore.getState().subscribedRoutes.map((r) => r.gtfsId));
    for (const id of tempMqttRouteIds.current) {
      // Skip routes that are also tracked by the nearby routes system
      const isNearby = nearbyMqttRouteIds.current.has(id);
      if (!permanentIds.has(id) && !isNearby) {
        mqttService.unsubscribeFromRoute(id);
        mqttService.removeActiveRoute(id);
      }
    }
    tempMqttRouteIds.current.clear();
  }, []);

  const clearSheetHistory = useCallback(() => {
    sheetHistoryRef.current = [];
  }, []);

  const pushCurrentSheetView = useCallback(() => {
    let entry: SheetHistoryEntry | null = null;

    if (activeTab === 'vehicles') {
      entry = { tab: 'vehicles', vehicleId: selectedVehicleId, stop: selectedStop };
    } else if (activeTab === 'routes' && selectedRouteId) {
      entry = { tab: 'routes', routeId: selectedRouteId, route: activatedRoute };
    } else if (activeTab === 'stops' && selectedStop) {
      entry = { tab: 'stops', stop: selectedStop };
    }

    if (!entry) return;

    const stack = sheetHistoryRef.current;
    const top = stack[stack.length - 1];
    if (!top || !isSameSheetHistoryEntry(top, entry)) {
      stack.push(entry);
    }
  }, [activeTab, selectedVehicleId, selectedRouteId, activatedRoute, selectedStop]);

  const ensureTemporaryRouteSubscription = useCallback((route: Route | SubscribedRoute) => {
    const permanentIds = new Set(useSubscriptionStore.getState().subscribedRoutes.map((r) => r.gtfsId));
    if (!permanentIds.has(route.gtfsId)) {
      tempMqttRouteIds.current.add(route.gtfsId);
      mqttService.subscribeToRoute(route.gtfsId);
      mqttService.addActiveRoute(route.gtfsId);
    }
  }, []);

  // Get user location for nearby mode and stops - only extract lat/lng to avoid spam from timestamp changes
  const userLocation = useLocationStore((state) => state.userLocation);
  const lastKnownLocation = useLocationStore((state) => state.lastKnownLocation);
  const effectiveLocation = userLocation ?? lastKnownLocation;
  const latitude = effectiveLocation?.latitude;
  const longitude = effectiveLocation?.longitude;
  const userCoords = useMemo(
    () => latitude !== undefined && longitude !== undefined ? { lat: latitude, lng: longitude } : null,
    [latitude, longitude]
  );

  // Stable coordinates for nearby calculations — only updates when the user
  // moves more than ~150m from the last position, avoiding constant GPS jitter.
  const stableCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const STABLE_THRESHOLD_DEG = 0.0015; // ~150m
  const stableCoords = useMemo(() => {
    if (!userCoords) return null;
    const prev = stableCoordsRef.current;
    if (prev && Math.abs(userCoords.lat - prev.lat) < STABLE_THRESHOLD_DEG
            && Math.abs(userCoords.lng - prev.lng) < STABLE_THRESHOLD_DEG) {
      return prev; // same reference — no query key change
    }
    const next = { lat: userCoords.lat, lng: userCoords.lng };
    stableCoordsRef.current = next;
    return next;
  }, [userCoords]);

  const { data: allStops, isLoading: stopsLoading } = useStops();

  const stopsForSearch = useMemo<StopWithOptionalDistance[]>(() => {
    if (!allStops) return [];

    if (!stableCoords) {
      return [...allStops].sort(compareStopsByDistanceThenName);
    }

    return allStops
      .map((stop) => ({
        ...stop,
        distance: haversineDistance(stableCoords.lat, stableCoords.lng, stop.lat, stop.lon),
      }))
      .sort(compareStopsByDistanceThenName);
  }, [allStops, stableCoords]);

  const nearbyStopsWithinRadius = useMemo<StopWithDistance[]>(() => {
    if (!stableCoords) return [];
    return stopsForSearch
      .filter(hasStopDistance)
      .filter((stop) => stop.distance <= nearbyRadius);
  }, [stopsForSearch, stableCoords, nearbyRadius]);

  // Apply theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Connect to MQTT on mount
  useEffect(() => {
    mqttService.connect().catch(console.error);
    watchUserLocation();

    let userInteracted = false;
    let disposed = false;
    let initialPan: ReturnType<typeof setTimeout> | undefined;
    const markInteraction = () => { userInteracted = true; };
    for (const event of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(event, markInteraction, { passive: true });

    // A delayed GPS fix must not pull the map away after browsing has begun.
    requestUserLocation()
      .then((location) => {
        if (disposed) return;
        initialPan = setTimeout(() => {
          if (userInteracted || disposed) return;
          const { flyToLocation, bottomPadding } = useLocationStore.getState();
          flyToLocation(location.latitude, location.longitude,
            radiusToZoom(useSettingsStore.getState().locationRadius, location.latitude, bottomPadding));
        }, 100);
      })
      .catch(console.error);

    return () => {
      disposed = true;
      clearTimeout(initialPan);
      for (const event of ['pointerdown', 'keydown', 'wheel']) document.removeEventListener(event, markInteraction);
      // During HMR the mqttService singleton persists via import.meta.hot.data,
      // so disconnecting would wipe its subscriptions set while React Refresh
      // preserves the useRef tracking (nearbyMqttRouteIds, tempMqttRouteIds).
      // That mismatch causes the nearby-routes effect to see no diff and skip
      // re-subscribing, losing all nearby vehicles.
      if (!import.meta.hot) {
        mqttService.disconnect();
      }
    };
  }, [flyToUserLocation]);

  // Subscribe to saved routes
  useEffect(() => {
    for (const route of subscribedRoutes) {
      mqttService.subscribeToRoute(route.gtfsId);
    }
  }, [subscribedRoutes]);

  // Handle nearby mode - additive, shows vehicles near user location
  const markNearbyVehiclesForExit = useVehicleStore((state) => state.markNearbyVehiclesForExit);
  const clearNearbyVehicles = useVehicleStore((state) => state.clearNearbyVehicles);

  useEffect(() => {
    if (!showNearby) {
      mqttService.clearNearby();
      // Animate out all nearby-only vehicles
      clearNearbyVehicles();
      return;
    }

    if (!stableCoords) {
      // Request location if we don't have it
      requestUserLocation().catch(console.error);
      return;
    }

    // Mark vehicles outside new radius for exit animation
    markNearbyVehiclesForExit(stableCoords, debouncedRadius);

    // Calculate bounding box from stable location and debouncedRadius
    // 1 degree of latitude ≈ 111km, 1 degree of longitude ≈ 65km at 60°N
    const latDelta = debouncedRadius / 111000;
    const lonDelta = debouncedRadius / 65000; // Adjusted for Helsinki's latitude

    const bounds: BoundingBox = {
      north: stableCoords.lat + latDelta,
      south: stableCoords.lat - latDelta,
      east: stableCoords.lng + lonDelta,
      west: stableCoords.lng - lonDelta,
    };

    console.log(`Nearby mode: subscribing to ${debouncedRadius}m radius around`, stableCoords);
    // Use atomic configureNearby to handle connection timing - if MQTT isn't
    // connected yet, it will store the config and apply it when connected
    mqttService.configureNearby(bounds, stableCoords, debouncedRadius);
  }, [showNearby, stableCoords, debouncedRadius, markNearbyVehiclesForExit, clearNearbyVehicles]);

  // Handle route selection - uses getState() to avoid dependency on subscribedRoutes
  const handleSelectRoute = useCallback(
    (route: Route) => {
      const currentRoutes = useSubscriptionStore.getState().subscribedRoutes;
      const isSubscribed = currentRoutes.some((r) => r.gtfsId === route.gtfsId);
      if (isSubscribed) {
        unsubscribeFromRoute(route.gtfsId);
        mqttService.unsubscribeFromRoute(route.gtfsId);
      } else {
        subscribeToRoute(route);
        mqttService.subscribeToRoute(route.gtfsId);
        tempMqttRouteIds.current.delete(route.gtfsId);
      }
    },
    [subscribeToRoute, unsubscribeFromRoute]
  );

  // Handle route activation (select without subscribing) - for nearby routes and search
  const handleActivateRoute = useCallback(
    (route: Route, options?: SheetNavigationOptions) => {
      if (!options?.preserveHistory) clearSheetHistory();
      setSelectedVehicleId(null);
      clearSelectedStop();
      cleanupTempSubscriptions();

      ensureTemporaryRouteSubscription(route);

      setSelectedRouteId(route.gtfsId);
      setActivatedRoute(route);
      showSheetTab('routes');
    },
    [clearSelectedStop, cleanupTempSubscriptions, clearSheetHistory, ensureTemporaryRouteSubscription, showSheetTab],
  );

  // Handle route activation from a stop — keeps the stop selected so users can navigate back to it.
  const handleActivateRouteFromStop = useCallback(
    (route: Route, options?: SheetNavigationOptions) => {
      if (!options?.preserveHistory) clearSheetHistory();
      setSelectedVehicleId(null);

      ensureTemporaryRouteSubscription(route);

      setSelectedRouteId(route.gtfsId);
      setActivatedRoute(route);
      showSheetTab('routes');
    },
    [clearSheetHistory, ensureTemporaryRouteSubscription, showSheetTab],
  );

  // Helper to clear route selection state and clean up temp subscriptions
  const clearRouteSelection = useCallback((routeId: string | null) => {
    setSelectedRouteId(routeId);
    if (!routeId) {
      setActivatedRoute(null);
      cleanupTempSubscriptions();
    }
  }, [cleanupTempSubscriptions]);

  const handleVehicleSelect = useCallback((vehicleId: string | null) => {
    clearSheetHistory();
    setSelectedVehicleId(vehicleId);
    if (vehicleId) {
      showSheetTab('vehicles');
    }
  }, [clearSheetHistory, showSheetTab]);

  const handleVehicleListClick = useCallback((vehicle: TrackedVehicle) => {
    clearSheetHistory();
    clearRouteSelection(null);
    clearSelectedStop();
    cleanupTempSubscriptions();
    setSelectedVehicleId(vehicle.vehicleId);
    showSheetTab('vehicles');
  }, [clearRouteSelection, clearSelectedStop, cleanupTempSubscriptions, clearSheetHistory, showSheetTab]);

  // Handle subscribe from vehicle card or details
  const handleSubscribeFromVehicle = useCallback(
    (vehicle: TrackedVehicle) => {
      const route: Route = {
        gtfsId: `HSL:${vehicle.routeId}`,
        shortName: vehicle.routeShortName,
        longName: vehicle.headsign,
        mode: vehicle.mode,
      };
      subscribeToRoute(route);
      mqttService.subscribeToRoute(route.gtfsId);
    },
    [subscribeToRoute]
  );

  // Handle subscribe from route object
  const handleSubscribeRoute = useCallback(
    (route: Route) => {
      subscribeToRoute(route);
      mqttService.subscribeToRoute(route.gtfsId);
      // Remove from temp tracking since it's now permanent
      tempMqttRouteIds.current.delete(route.gtfsId);
    },
    [subscribeToRoute]
  );

  // Handle unsubscribe
  const handleUnsubscribe = useCallback(
    (gtfsId: string) => {
      unsubscribeFromRoute(gtfsId);
      mqttService.unsubscribeFromRoute(gtfsId);
    },
    [unsubscribeFromRoute]
  );

  const handleClearSelectedEntity = useCallback(() => {
    clearSheetHistory();
    setSelectedVehicleId(null);
    clearRouteSelection(null);
    clearSelectedStop();
  }, [clearRouteSelection, clearSelectedStop, clearSheetHistory]);

  // Handle locate me
  const handleLocateMe = useCallback(async () => {
    try {
      // Close any open detail subviews
      clearSheetHistory();
      setSelectedVehicleId(null);
      clearRouteSelection(null);
      clearSelectedStop();
      cleanupTempSubscriptions();
      await requestUserLocation();
      flyToUserLocation();
    } catch (error) {
      console.error('Failed to get location:', error);
    }
  }, [flyToUserLocation, clearRouteSelection, clearSelectedStop, cleanupTempSubscriptions, clearSheetHistory]);

  // Handle stop click from list or map
  const handleStopClick = useCallback(
    (stop: Stop) => {
      clearSheetHistory();
      // Save scroll position before switching to StopDetails
      if (sheetContentRef.current) {
        stopListScrollRef.current = sheetContentRef.current.scrollTop;
      }

      // Clear other selections
      setSelectedVehicleId(null);
      clearRouteSelection(null);
      cleanupTempSubscriptions();

      // Toggle stop selection
      if (selectedStop?.gtfsId === stop.gtfsId) {
        clearSelectedStop();
      } else {
        selectStop(stop);
        showSheetTab('stops');
        const { flyToLocation } = useLocationStore.getState();
        flyToLocation(stop.lat, stop.lon, 13);

        // Temporarily subscribe to MQTT for stop's routes (not persisted)
        const permanentIds = new Set(useSubscriptionStore.getState().subscribedRoutes.map((r) => r.gtfsId));
        for (const route of stop.routes) {
          if (!permanentIds.has(route.gtfsId)) {
            tempMqttRouteIds.current.add(route.gtfsId);
            mqttService.subscribeToRoute(route.gtfsId);
            mqttService.addActiveRoute(route.gtfsId);
          }
        }
      }
    },
    [selectedStop, selectStop, clearRouteSelection, clearSelectedStop, clearSheetHistory, showSheetTab, cleanupTempSubscriptions],
  );

  const restoreSelectedStopContext = useCallback(() => {
    cleanupTempSubscriptions();
    showSheetTab('stops');

    const stop = useStopStore.getState().selectedStop;
    if (!stop) return;

    const { flyToLocation } = useLocationStore.getState();
    flyToLocation(stop.lat, stop.lon, 14);

    for (const route of stop.routes) {
      ensureTemporaryRouteSubscription(route);
    }
  }, [cleanupTempSubscriptions, ensureTemporaryRouteSubscription, showSheetTab]);

  const restorePreviousSheetView = useCallback(() => {
    const previous = sheetHistoryRef.current.pop();
    if (!previous) return false;

    if (previous.tab === 'stops') {
      selectStop(previous.stop);
      setSelectedVehicleId(null);
      setSelectedRouteId(null);
      setActivatedRoute(null);
      restoreSelectedStopContext();
      return true;
    }

    if (previous.tab === 'routes') {
      setSelectedVehicleId(null);
      if (previous.route) {
        ensureTemporaryRouteSubscription(previous.route);
      }
      setSelectedRouteId(previous.routeId);
      setActivatedRoute(previous.route);
      showSheetTab('routes');
      return true;
    }

    setSelectedRouteId(null);
    setActivatedRoute(null);
    cleanupTempSubscriptions();
    if (previous.stop) {
      selectStop(previous.stop);
      for (const route of previous.stop.routes) ensureTemporaryRouteSubscription(route);
    } else {
      clearSelectedStop();
    }
    const vehicle = previous.vehicleId ? useVehicleStore.getState().vehicles.get(previous.vehicleId) : undefined;
    if (vehicle) {
      ensureTemporaryRouteSubscription({
        gtfsId: `HSL:${vehicle.routeId}`, shortName: vehicle.routeShortName,
        longName: vehicle.headsign, mode: vehicle.mode,
      });
      useLocationStore.getState().flyToLocation(vehicle.lat, vehicle.lng, VEHICLE_FLY_TO_ZOOM);
    }
    setSelectedVehicleId(previous.vehicleId);
    showSheetTab('vehicles');
    return true;
  }, [cleanupTempSubscriptions, ensureTemporaryRouteSubscription, restoreSelectedStopContext, selectStop, clearSelectedStop, showSheetTab]);

  // Navigate back to the selected stop from a vehicle or route detail subview.
  const handleBackToStop = useCallback(() => {
    setSelectedVehicleId(null);
    setSelectedRouteId(null);
    setActivatedRoute(null);
    restoreSelectedStopContext();
  }, [restoreSelectedStopContext]);

  // Handle back from stop details
  const handleStopBack = useCallback(() => {
    if (restorePreviousSheetView()) return;

    clearSheetHistory();
    cleanupTempSubscriptions();
    clearSelectedStop();
    // Restore scroll position after NearbyStops re-mounts
    requestAnimationFrame(() => {
      if (sheetContentRef.current) {
        sheetContentRef.current.scrollTop = stopListScrollRef.current;
      }
    });
  }, [clearSelectedStop, cleanupTempSubscriptions, clearSheetHistory, restorePreviousSheetView]);

  // Handle clicking a timetable departure to find and select matching vehicle
  const handleDepartureClick = useCallback(
    (departure: StopDeparture) => {
      const vehicles = useVehicleStore.getState().vehicles;

      let bestMatch: TrackedVehicle | null = null;

      for (const vehicle of vehicles.values()) {
        if (findMatchingVehicle(vehicle, departure, 0, 0)) {
          bestMatch = vehicle;
          break;
        }
      }

      if (bestMatch) {
        pushCurrentSheetView();
        setSelectedVehicleId(bestMatch.vehicleId);
        // Only clear route UI state — don't cleanup temp subscriptions since the stop is still active
        setSelectedRouteId(null);
        setActivatedRoute(null);
        showSheetTab('vehicles');
        const { flyToLocation } = useLocationStore.getState();
        flyToLocation(bestMatch.lat, bestMatch.lng, VEHICLE_FLY_TO_ZOOM);
      }
    },
    [pushCurrentSheetView, showSheetTab],
  );

  // Close nearby menu when clicking outside, and keep position up-to-date while open
  useEffect(() => {
    if (!nearbyMenuOpen) return;

    let rafId: number;
    const updateRect = () => {
      if (!nearbyBtnRef.current) return;
      const rect = nearbyBtnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const above = spaceBelow < 280;
      setNearbyMenuRect({
        top: above ? rect.top : rect.bottom + 4,
        right: window.innerWidth - rect.right,
        above,
      });
      rafId = requestAnimationFrame(updateRect);
    };
    rafId = requestAnimationFrame(updateRect);

    const handleClickOutside = (e: MouseEvent) => {
      if (nearbyMenuRef.current && !nearbyMenuRef.current.contains(e.target as Node)) {
        setNearbyMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      cancelAnimationFrame(rafId);
    };
  }, [nearbyMenuOpen]);

  // Nearby routes: routes from nearby stops that aren't already subscribed
  const nearbyRouteDistanceMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!showNearbyRoutes || !nearbyStopsWithinRadius) return map;
    for (const stop of nearbyStopsWithinRadius) {
      for (const route of stop.routes) {
        const existing = map.get(route.gtfsId);
        if (existing === undefined || stop.distance < existing) {
          map.set(route.gtfsId, stop.distance);
        }
      }
    }
    return map;
  }, [showNearbyRoutes, nearbyStopsWithinRadius]);

  const sortedSubscribedRoutes = useMemo(() => {
    return [...subscribedRoutes].sort((a, b) => {
      const aDistance = nearbyRouteDistanceMap.get(a.gtfsId);
      const bDistance = nearbyRouteDistanceMap.get(b.gtfsId);

      if (aDistance !== undefined || bDistance !== undefined) {
        if (aDistance === undefined) return 1;
        if (bDistance === undefined) return -1;
        if (aDistance !== bDistance) return aDistance - bDistance;
      }

      const aNum = parseInt(a.shortName, 10);
      const bNum = parseInt(b.shortName, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.shortName.localeCompare(b.shortName);
    });
  }, [subscribedRoutes, nearbyRouteDistanceMap]);

  const nearbyRoutes = useMemo(() => {
    if (!nearbyStopsWithinRadius || !showNearbyRoutes) return [];
    const routeMap = new Map<string, Route>();
    const subscribedIds = new Set(subscribedRoutes.map((r) => r.gtfsId));
    for (const stop of nearbyStopsWithinRadius) {
      for (const r of stop.routes) {
        if (!routeMap.has(r.gtfsId) && !subscribedIds.has(r.gtfsId)) {
          routeMap.set(r.gtfsId, { gtfsId: r.gtfsId, shortName: r.shortName, longName: r.longName, mode: r.mode });
        }
      }
    }
    return Array.from(routeMap.values()).sort((a, b) => {
      const aDistance = nearbyRouteDistanceMap.get(a.gtfsId);
      const bDistance = nearbyRouteDistanceMap.get(b.gtfsId);

      if (aDistance !== undefined || bDistance !== undefined) {
        if (aDistance === undefined) return 1;
        if (bDistance === undefined) return -1;
        if (aDistance !== bDistance) return aDistance - bDistance;
      }

      const aNum = parseInt(a.shortName, 10);
      const bNum = parseInt(b.shortName, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.shortName.localeCompare(b.shortName);
    });
  }, [nearbyStopsWithinRadius, showNearbyRoutes, subscribedRoutes, nearbyRouteDistanceMap]);

  // Fetch route patterns for subscribed routes + temporarily activated routes + nearby routes
  const nearbyRouteIds = useMemo(
    () => nearbyRoutes.map((r) => r.gtfsId),
    [nearbyRoutes],
  );

  // Subscribe to MQTT for nearby routes when they change
  useEffect(() => {
    const permanentIds = new Set(subscribedRoutes.map((r) => r.gtfsId));
    const newIds = new Set(nearbyRouteIds);

    // Unsubscribe from routes that are no longer nearby
    for (const id of nearbyMqttRouteIds.current) {
      if (!newIds.has(id) && !permanentIds.has(id)) {
        mqttService.unsubscribeFromRoute(id);
        mqttService.removeActiveRoute(id);
      }
    }

    // Subscribe to new nearby routes
    for (const id of newIds) {
      if (!nearbyMqttRouteIds.current.has(id) && !permanentIds.has(id)) {
        mqttService.subscribeToRoute(id);
        mqttService.addActiveRoute(id);
      }
    }

    nearbyMqttRouteIds.current = newIds;
  }, [nearbyRouteIds, subscribedRoutes]);

  const routeIds = useMemo(() => {
    const ids = new Set(subscribedRoutes.map((r) => r.gtfsId));
    if (selectedVehicleRouteId) ids.add(`HSL:${selectedVehicleRouteId}`);
    // Include selected route if not already subscribed
    if (selectedRouteId) ids.add(selectedRouteId);
    // Include stop routes if a stop is selected
    for (const id of selectedStopRouteIds) ids.add(id);
    // Include nearby routes when enabled
    for (const id of nearbyRouteIds) ids.add(id);
    return Array.from(ids);
  }, [subscribedRoutes, selectedVehicleRouteId, selectedRouteId, selectedStopRouteIds, nearbyRouteIds]);
  const { data: patterns } = useRoutePatterns(routeIds);

  const selectedRoute = useMemo((): Route | SubscribedRoute | null => {
    if (!selectedRouteId) return null;

    const subscribed = subscribedRoutes.find((route) => route.gtfsId === selectedRouteId);
    if (subscribed) return subscribed;

    for (const stop of stopsForSearch) {
      const stopRoute = stop.routes.find((route) => route.gtfsId === selectedRouteId);
      if (stopRoute) return { ...stopRoute };
    }

    const vehicle = vehicles.find((v) => `HSL:${v.routeId}` === selectedRouteId);
    if (vehicle) {
      return {
        gtfsId: selectedRouteId,
        shortName: vehicle.routeShortName,
        longName: vehicle.headsign,
        mode: vehicle.mode,
      };
    }

    if (activatedRoute?.gtfsId === selectedRouteId) {
      return activatedRoute;
    }

    return null;
  }, [selectedRouteId, subscribedRoutes, stopsForSearch, vehicles, activatedRoute]);

  const selectedRoutePatterns = selectedRouteId ? patterns?.get(selectedRouteId) : undefined;
  const isSelectedRouteSubscribed = selectedRouteId
    ? subscribedRoutes.some((route) => route.gtfsId === selectedRouteId)
    : false;

  const handleMapRouteActivate = useCallback(
    (route: Route) => {
      if (selectedStop) {
        handleActivateRouteFromStop(route);
      } else {
        handleActivateRoute(route);
      }
    },
    [selectedStop, handleActivateRouteFromStop, handleActivateRoute],
  );

  const handleVehicleRouteActivate = useCallback(
    (route: Route) => {
      pushCurrentSheetView();
      if (selectedStop) {
        handleActivateRouteFromStop(route, { preserveHistory: true });
      } else {
        handleActivateRoute(route, { preserveHistory: true });
      }
    },
    [selectedStop, pushCurrentSheetView, handleActivateRouteFromStop, handleActivateRoute],
  );

  const handleStopRouteActivate = useCallback(
    (route: Route) => {
      pushCurrentSheetView();
      handleActivateRouteFromStop(route, { preserveHistory: true });
    },
    [pushCurrentSheetView, handleActivateRouteFromStop],
  );

  const handleVehicleDetailsBack = useCallback(() => {
    if (restorePreviousSheetView()) return;

    if (selectedStop) {
      handleBackToStop();
    } else {
      setSelectedVehicleId(null);
    }
  }, [selectedStop, handleBackToStop, restorePreviousSheetView]);

  const handleRouteDetailsBack = useCallback(() => {
    if (restorePreviousSheetView()) return;

    if (selectedStop) {
      handleBackToStop();
    } else {
      clearRouteSelection(null);
    }
  }, [selectedStop, handleBackToStop, clearRouteSelection, restorePreviousSheetView]);

  const handleSelectedVehicleSubscribe = useCallback(() => {
    if (selectedVehicle) {
      handleSubscribeFromVehicle(selectedVehicle);
    }
  }, [selectedVehicle, handleSubscribeFromVehicle]);

  const handleSelectedVehicleUnsubscribe = useCallback(() => {
    if (selectedVehicle) {
      handleUnsubscribe(`HSL:${selectedVehicle.routeId}`);
    }
  }, [selectedVehicle, handleUnsubscribe]);

  const handleSelectedRouteSubscribe = useCallback(() => {
    if (selectedRoute) {
      handleSubscribeRoute(selectedRoute);
    }
  }, [selectedRoute, handleSubscribeRoute]);

  const handleSelectedRouteUnsubscribe = useCallback(() => {
    if (selectedRouteId) {
      handleUnsubscribe(selectedRouteId);
    }
  }, [selectedRouteId, handleUnsubscribe]);

  const handleRouteVehicleSelect = useCallback((vehicle: TrackedVehicle) => {
    pushCurrentSheetView();
    if (selectedStop) {
      setSelectedRouteId(null);
      setActivatedRoute(null);
    } else {
      clearRouteSelection(null);
    }
    setSelectedVehicleId(vehicle.vehicleId);
    showSheetTab('vehicles');

    const { flyToLocation } = useLocationStore.getState();
    flyToLocation(vehicle.lat, vehicle.lng, VEHICLE_FLY_TO_ZOOM);
  }, [selectedStop, clearRouteSelection, pushCurrentSheetView, showSheetTab]);

  return (
    <div className="h-full w-full relative bg-gray-100 dark:bg-gray-950">
      {/* Map */}
      <BusMap
        patterns={patterns}
        nearbyRadius={anyNearbyActive ? nearbyRadius : undefined}
        selectedVehicleId={selectedVehicleId}
        onVehicleSelect={handleVehicleSelect}
        selectedRouteId={selectedRouteId}
        activatedRoute={activatedRoute}
        onRouteSelect={clearRouteSelection}
        bottomPadding={sheetHeight}
        nearbyStops={nearbyStopsWithinRadius}
        onStopClick={handleStopClick}
        onStopDeselect={handleStopBack}
        onRouteActivate={handleMapRouteActivate}
        nearbyRouteIds={nearbyRouteIds}
        onCameraActionsChange={setMapCameraActions}
        onCameraStateChange={setMapCameraState}
      />

      {/* Status bar with search */}
      <StatusBar onActivateRoute={handleActivateRoute} onToggleRouteSubscription={handleSelectRoute} stops={stopsForSearch} onStopClick={handleStopClick} />

      {/* FABs - bottom right, move with bottom sheet */}
      <motion.div
        className="fixed right-4 z-30 flex flex-col gap-2"
        style={{ bottom: fabBottom }}
      >
        <FloatingActionButton
          icon={<SettingsIcon />}
          onClick={() => setIsSettingsOpen(true)}
          label="Settings"
        />
        <FloatingActionButton
          icon={<LocationIcon />}
          onClick={handleLocateMe}
          label="Go to my location"
        />
      </motion.div>

      {/* Bottom sheet with tabs */}
      <BottomSheet
        minHeight={SHEET_MIN_HEIGHT}
        maxHeight={SHEET_MAX_HEIGHT}
        initialHeight={useSettingsStore.getState().sheetHeight}
        onHeightMotionValue={handleHeightMV}
        onHeightChange={(h) => {
          setSheetHeight(h);
          setBottomPadding(h);
          clearTimeout(sheetPersistTimeoutRef.current);
          sheetPersistTimeoutRef.current = setTimeout(() => setPersistedSheetHeight(h), 300);
        }}
        onExpand={(expand) => { expandSheetRef.current = expand; }}
        onClose={handleClearSelectedEntity}
        contentRef={sheetContentRef}
        header={
          <div className="flex items-center gap-1 mb-2 pt-1">
            <div className="flex items-center gap-0.5 min-[425px]:gap-2 flex-1 min-w-0">
              <button
                className={`shrink-0 whitespace-nowrap px-2 min-[425px]:px-3 min-h-11 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'vehicles'
                    ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => {
                  clearSheetHistory();
                  switchTab('vehicles');
                }}
              >
                Vehicles
              </button>
              <button
                className={`shrink-0 whitespace-nowrap px-2 min-[425px]:px-3 min-h-11 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'routes'
                    ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => {
                  clearSheetHistory();
                  switchTab('routes');
                }}
              >
                Routes
              </button>
              <button
                className={`shrink-0 whitespace-nowrap px-2 min-[425px]:px-3 min-h-11 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'stops'
                    ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => {
                  clearSheetHistory();
                  switchTab('stops');
                }}
              >
                Stops
              </button>
            </div>
            <div className="relative shrink-0" ref={nearbyMenuRef}>
              <button
                className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-2 rounded-lg text-sm font-medium transition-colors ${
                  anyNearbyActive
                    ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => setNearbyMenuOpen(!nearbyMenuOpen)}
                ref={nearbyBtnRef}
                aria-label="Nearby options"
                aria-expanded={nearbyMenuOpen}
              >
                <span className="hidden min-[375px]:inline">Nearby</span>
                <span className="block h-4 w-4 min-[375px]:hidden"><LocationIcon /></span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={nearbyMenuOpen ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                </svg>
              </button>
              {nearbyMenuOpen && nearbyMenuRect && (
                <div
                  className="fixed w-56 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
                  style={nearbyMenuRect.above
                    ? { bottom: window.innerHeight - nearbyMenuRect.top + 4, right: nearbyMenuRect.right }
                    : { top: nearbyMenuRect.top, right: nearbyMenuRect.right }
                  }>
                  <label className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-200">Vehicles</span>
                    <input type="checkbox" checked={showNearby} onChange={(e) => setShowNearby(e.target.checked)} className="w-4 h-4 accent-primary-500" />
                  </label>
                  <label className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-200">Routes</span>
                    <input type="checkbox" checked={showNearbyRoutes} onChange={(e) => setShowNearbyRoutes(e.target.checked)} className="w-4 h-4 accent-primary-500" />
                  </label>
                  <label className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-200">Stops</span>
                    <input type="checkbox" checked={showStops} onChange={(e) => setShowStops(e.target.checked)} className="w-4 h-4 accent-primary-500" />
                  </label>
                  <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      Radius
                    </div>
                    <input
                      type="range"
                      min="250"
                      max="4000"
                      step="250"
                      value={nearbyRadius}
                      onChange={(e) => setNearbyRadius(Number(e.target.value))}
                      className="w-full accent-primary-500"
                    />
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 text-center">
                      {nearbyRadius < 1000
                        ? `${nearbyRadius} m`
                        : `${(nearbyRadius / 1000).toFixed(1)} km`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        }
      >
        <div className="pb-16 pt-0.5">
          {/* Tab content */}
          {activeTab === 'vehicles' ? (
            selectedVehicle ? (
              <VehicleDetails
                key={selectedVehicle.vehicleId}
                vehicle={selectedVehicle}
                onBack={handleVehicleDetailsBack}
                onSubscribe={handleSelectedVehicleSubscribe}
                onUnsubscribe={handleSelectedVehicleUnsubscribe}
                isFollowing={mapCameraState.isFollowingVehicle}
                onReFollow={mapCameraActions?.refollowVehicle}
                onRouteActivate={handleVehicleRouteActivate}
                onStopClick={(stop) => {
                  const fullStop = stopsForSearch.find((candidate) => candidate.gtfsId === stop.gtfsId) ?? stop;
                  pushCurrentSheetView();
                  setSelectedVehicleId(null);
                  setSelectedRouteId(null);
                  setActivatedRoute(null);
                  selectStop(fullStop);
                  // Keep the vehicle's route subscribed while viewing its stop.
                  for (const route of fullStop.routes) ensureTemporaryRouteSubscription(route);
                  showSheetTab('stops');
                  useLocationStore.getState().flyToLocation(fullStop.lat, fullStop.lon, 14);
                }}
                backTitle={previousViewLabel ?? (selectedStop ? `Back to ${selectedStop.name}` : 'Back to vehicles')}
              />
            ) : (
              <>
                <NearbyDepartures stops={nearbyStopsWithinRadius} isCurrent={!!userLocation} onSelect={(stop) => {
                  handleStopClick(stop);
                  pushCurrentSheetView();
                }} />
                <section aria-label="Live vehicles">
                  <VehicleList
                    selectedVehicleId={selectedVehicleId}
                    onVehicleClick={handleVehicleListClick}
                    onSubscribe={handleSubscribeFromVehicle}
                    onUnsubscribe={handleUnsubscribe}
                  />
                </section>
              </>
            )
          ) : activeTab === 'routes' ? (
            selectedRoute ? (
              <RouteDetails
                route={selectedRoute}
                isSubscribed={isSelectedRouteSubscribed}
                patterns={selectedRoutePatterns}
                vehicles={vehicles}
                onBack={handleRouteDetailsBack}
                onSubscribe={handleSelectedRouteSubscribe}
                onUnsubscribe={handleSelectedRouteUnsubscribe}
                onReCenter={mapCameraState.hasMovedFromRoute ? mapCameraActions?.recenterRoute : undefined}
                onVehicleSelect={handleRouteVehicleSelect}
                backTitle={previousViewLabel ?? (selectedStop ? `Back to ${selectedStop.name}` : 'Back to routes')}
              />
            ) : (
              <>
                <RoutesList
                  routes={sortedSubscribedRoutes}
                  onUnsubscribe={handleUnsubscribe}
                  onRouteClick={(route) => {
                    clearSheetHistory();
                    setSelectedVehicleId(null);
                    clearSelectedStop();
                    cleanupTempSubscriptions();
                    setSelectedRouteId(route.gtfsId);
                    setActivatedRoute(route);
                    showSheetTab('routes');
                  }}
                  selectedRouteId={selectedRouteId}
                  hasNearbyRoutes={nearbyRoutes.length > 0}
                />
                {showNearbyRoutes && nearbyRoutes.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">Nearby Routes</h3>
                    <div className="space-y-2 px-0.5">
                      {nearbyRoutes.map((route) => {
                        const color = resolveRouteColor({
                          routeId: route.gtfsId,
                          mode: route.mode ?? 'bus',
                          colorMode: routeColorMode,
                          isSubscribed: false,
                        });
                        const isActive = selectedRouteId === route.gtfsId;
                        return (
                          <div
                            key={route.gtfsId}
                            className={`bg-gray-50 dark:bg-gray-800 rounded-xl p-2 min-[425px]:p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${isActive ? 'outline outline-2 outline-primary-500' : ''}`}
                            onClick={() => handleActivateRoute(route)}
                          >
                            <div
                              className="w-10 h-10 min-[425px]:w-12 min-[425px]:h-12 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                              style={{ backgroundColor: color }}
                            >
                              {route.shortName}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900 dark:text-white truncate">
                                {route.longName}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                                {route.mode}
                              </div>
                            </div>
                            <StarToggleButton
                              active={subscribedRoutes.some((r) => r.gtfsId === route.gtfsId)}
                              onToggle={() => handleSelectRoute(route)}
                              title={subscribedRoutes.some((r) => r.gtfsId === route.gtfsId) ? 'Remove route' : 'Track this route'}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )
          ) : selectedStop ? (
            <StopDetails
              stop={selectedStop}
              onBack={handleStopBack}
              backTitle={previousViewLabel ?? 'Back to stops'}
              onDepartureClick={handleDepartureClick}
              onReCenter={mapCameraState.hasMovedFromStop ? mapCameraActions?.recenterStop : undefined}
              onRouteActivate={handleStopRouteActivate}
            />
          ) : (
            <NearbyStops
              stops={nearbyStopsWithinRadius}
              isLoading={stopsLoading}
              onStopClick={handleStopClick}
            />
          )}
        </div>
      </BottomSheet>

      {/* Settings panel */}
      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Update toast */}
      <UpdateToast />
    </div>
  );
};

// Routes list component for bottom sheet tab
interface RoutesListProps {
  routes: SubscribedRoute[];
  onUnsubscribe: (gtfsId: string) => void;
  onRouteClick?: (route: SubscribedRoute) => void;
  selectedRouteId?: string | null;
  hasNearbyRoutes?: boolean;
}

const RoutesList = ({ routes, onUnsubscribe, onRouteClick, selectedRouteId, hasNearbyRoutes }: RoutesListProps) => {
  const routeColorMode = useSettingsStore((state) => state.routeColorMode);

  if (routes.length === 0 && !hasNearbyRoutes) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No routes</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[220px]">
          Search for routes to track them, or enable nearby mode to discover routes near you
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-0.5">
      <AnimatePresence mode="popLayout" initial={false}>
        {routes.map((route) => {
          const color = resolveRouteColor({
            routeId: route.gtfsId,
            mode: route.mode,
            colorMode: routeColorMode,
            isSubscribed: true,
          });
          const isSelected = selectedRouteId === route.gtfsId;
          return (
            <motion.div
              key={route.gtfsId}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, x: -100 }}
              transition={{ opacity: { duration: 0.15 }, scale: { duration: 0.15 } }}
              className={`bg-gray-50 dark:bg-gray-800 rounded-xl p-2 min-[425px]:p-3 flex items-center gap-3 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${isSelected ? 'outline outline-2 outline-primary-500' : ''}`}
              onClick={() => onRouteClick?.(route)}
            >
              <div
                className="w-10 h-10 min-[425px]:w-12 min-[425px]:h-12 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ backgroundColor: color }}
              >
                {route.shortName}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-white truncate">
                  {route.longName}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 dark:text-gray-400 capitalize">{route.mode}</span>
                </div>
              </div>
              <StarToggleButton
                active={true}
                onToggle={() => onUnsubscribe(route.gtfsId)}
                title="Remove route"
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default App;
