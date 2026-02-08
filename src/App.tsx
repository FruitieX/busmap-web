import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, type MotionValue } from 'framer-motion';
import {
  BusMap,
  VehicleList,
  NearbyStops,
  StopDetails,
  BottomSheet,
  StatusBar,
  FloatingActionButton,
  SettingsPanel,
  UpdateToast,
  ConfirmDeleteButton,
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
import { mqttService, useRoutePatterns, useNearbyStops } from '@/lib';
import type { Route, TrackedVehicle, BoundingBox, SubscribedRoute, RoutePattern, Stop, StopDeparture } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import {
  SHEET_MIN_HEIGHT,
  SHEET_MAX_HEIGHT,
  SHEET_EXPAND_THRESHOLD,
  FAB_TOP_OFFSET,
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

const TAB_STORAGE_KEY = 'busmap-active-tab';

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
  const expandSheetRef = useRef<(() => void) | null>(null);

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

  const showNearby = useSettingsStore((state) => state.showNearby);
  const nearbyRadius = useSettingsStore((state) => state.nearbyRadius);
  const setShowNearby = useSettingsStore((state) => state.setShowNearby);
  const showStops = useSettingsStore((state) => state.showStops);
  const setShowStops = useSettingsStore((state) => state.setShowStops);
  const showNearbyRoutes = useSettingsStore((state) => state.showNearbyRoutes);
  const setShowNearbyRoutes = useSettingsStore((state) => state.setShowNearbyRoutes);

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
  const { subscribeToRoute, unsubscribeFromRoute } = useSubscriptionStore();
  const flyToUserLocation = useLocationStore((state) => state.flyToUserLocation);
  const setBottomPadding = useLocationStore((state) => state.setBottomPadding);

  // Stops store
  const { selectedStop, selectedStopRouteIds, selectStop, clearSelectedStop } = useStopStore();

  // Temporary MQTT subscriptions for activated (not permanently subscribed) routes
  const tempMqttRouteIds = useRef(new Set<string>());

  // Clean up temporary MQTT subscriptions that aren't permanently subscribed
  const cleanupTempSubscriptions = useCallback(() => {
    const permanentIds = new Set(useSubscriptionStore.getState().subscribedRoutes.map((r) => r.gtfsId));
    for (const id of tempMqttRouteIds.current) {
      if (!permanentIds.has(id)) {
        mqttService.unsubscribeFromRoute(id);
      }
    }
    tempMqttRouteIds.current.clear();
    mqttService.clearActiveRoutes();
  }, []);

  // Get user location for nearby mode and stops - only extract lat/lng to avoid spam from timestamp changes
  const userLocation = useLocationStore((state) => state.userLocation);
  const lastKnownLocation = useLocationStore((state) => state.lastKnownLocation);
  const effectiveLocation = userLocation ?? lastKnownLocation;
  const userCoords = useMemo(
    () => effectiveLocation ? { lat: effectiveLocation.latitude, lng: effectiveLocation.longitude } : null,
    [effectiveLocation?.latitude, effectiveLocation?.longitude]
  );

  // Stable coordinates for nearby stops query — only updates when the user
  // moves more than ~150m from the last query position, avoiding both constant
  // GPS jitter and the rounding-boundary oscillation problem.
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
  }, [userCoords?.lat, userCoords?.lng]);

  // Nearby stops query - fetch 100 nearest stops (large radius so `first: 100` is the actual limit)
  const { data: allNearbyStops, isLoading: stopsLoading } = useNearbyStops(
    stableCoords?.lat ?? null,
    stableCoords?.lng ?? null,
    4000,
  );

  // Filter nearby stops by the user-configured radius
  const nearbyStops = useMemo(
    () => allNearbyStops?.filter((s) => s.distance <= nearbyRadius),
    [allNearbyStops, nearbyRadius],
  );

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

    // Pan to user location on startup (with delay to let map initialize)
    requestUserLocation()
      .then(() => {
        setTimeout(() => {
          flyToUserLocation();
        }, 100);
      })
      .catch(console.error);

    return () => {
      mqttService.disconnect();
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

    if (!userCoords) {
      // Request location if we don't have it
      requestUserLocation().catch(console.error);
      return;
    }

    // Mark vehicles outside new radius for exit animation
    markNearbyVehiclesForExit(userCoords, debouncedRadius);

    // Calculate bounding box from user location and debouncedRadius
    // 1 degree of latitude ≈ 111km, 1 degree of longitude ≈ 65km at 60°N
    const latDelta = debouncedRadius / 111000;
    const lonDelta = debouncedRadius / 65000; // Adjusted for Helsinki's latitude

    const bounds: BoundingBox = {
      north: userCoords.lat + latDelta,
      south: userCoords.lat - latDelta,
      east: userCoords.lng + lonDelta,
      west: userCoords.lng - lonDelta,
    };

    console.log(`Nearby mode: subscribing to ${debouncedRadius}m radius around`, userCoords);
    // Use atomic configureNearby to handle connection timing - if MQTT isn't
    // connected yet, it will store the config and apply it when connected
    mqttService.configureNearby(bounds, userCoords, debouncedRadius);
  }, [showNearby, userCoords, debouncedRadius, markNearbyVehiclesForExit, clearNearbyVehicles]);

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
    (route: Route) => {
      setSelectedVehicleId(null);
      clearSelectedStop();
      cleanupTempSubscriptions();

      // If already permanently subscribed, just select it
      const permanentIds = new Set(useSubscriptionStore.getState().subscribedRoutes.map((r) => r.gtfsId));
      if (!permanentIds.has(route.gtfsId)) {
        // Temporarily subscribe to MQTT to see vehicles
        tempMqttRouteIds.current.add(route.gtfsId);
        mqttService.subscribeToRoute(route.gtfsId);
        mqttService.addActiveRoute(route.gtfsId);
      }

      setSelectedRouteId(route.gtfsId);
      setActivatedRoute(route);
    },
    [clearSelectedStop, cleanupTempSubscriptions],
  );

  // Helper to clear route selection state and clean up temp subscriptions
  const clearRouteSelection = useCallback((routeId: string | null) => {
    setSelectedRouteId(routeId);
    if (!routeId) {
      setActivatedRoute(null);
      cleanupTempSubscriptions();
    }
  }, [cleanupTempSubscriptions]);

  // Handle subscribe from vehicle card or popover
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

  // Handle locate me
  const handleLocateMe = useCallback(async () => {
    try {
      // Close any open popovers
      setSelectedVehicleId(null);
      clearRouteSelection(null);
      clearSelectedStop();
      cleanupTempSubscriptions();
      await requestUserLocation();
      flyToUserLocation();
    } catch (error) {
      console.error('Failed to get location:', error);
    }
  }, [flyToUserLocation, clearSelectedStop, cleanupTempSubscriptions]);

  // Handle stop click from list or map
  const handleStopClick = useCallback(
    (stop: Stop) => {
      // Clear other selections
      setSelectedVehicleId(null);
      clearRouteSelection(null);
      cleanupTempSubscriptions();

      // Toggle stop selection
      if (selectedStop?.gtfsId === stop.gtfsId) {
        clearSelectedStop();
      } else {
        selectStop(stop);
        // Switch to stops tab and fly to the stop
        switchTab('stops');
        const { flyToLocation } = useLocationStore.getState();
        flyToLocation(stop.lat, stop.lon, 14);

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
    [selectedStop, selectStop, clearSelectedStop, switchTab, cleanupTempSubscriptions],
  );

  // Handle back from stop details
  const handleStopBack = useCallback(() => {
    cleanupTempSubscriptions();
    clearSelectedStop();
  }, [clearSelectedStop, cleanupTempSubscriptions]);

  // Handle clicking a timetable departure to find and select matching vehicle
  const handleDepartureClick = useCallback(
    (departure: StopDeparture) => {
      const vehicles = useVehicleStore.getState().vehicles;
      const routeId = departure.routeGtfsId.replace('HSL:', '');
      const mqttDir = (departure.directionId + 1) as 1 | 2;

      let bestMatch: TrackedVehicle | null = null;
      let bestDistance = Infinity;

      for (const vehicle of vehicles.values()) {
        if (vehicle.routeId !== routeId || vehicle.direction !== mqttDir) continue;

        // Match by trip start time (HH:mm) for exact trip identification
        if (vehicle.startTime === departure.tripStartTime) {
          bestMatch = vehicle;
          break;
        }

        // Fallback: closest vehicle to the stop (if startTime doesn't match exactly)
        if (selectedStop) {
          const dist = Math.abs(vehicle.lat - selectedStop.lat) + Math.abs(vehicle.lng - selectedStop.lon);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestMatch = vehicle;
          }
        }
      }

      if (bestMatch) {
        setSelectedVehicleId(bestMatch.vehicleId);
        clearRouteSelection(null);
        // Keep the stop active - don't clear it
        const { flyToLocation } = useLocationStore.getState();
        flyToLocation(bestMatch.lat, bestMatch.lng, VEHICLE_FLY_TO_ZOOM);
      }
    },
    [selectedStop],
  );

  // Per-tab nearby toggle value and handler
  const anyNearbyActive = showNearby || showNearbyRoutes || showStops;

  // Close nearby menu when clicking outside
  useEffect(() => {
    if (!nearbyMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (nearbyMenuRef.current && !nearbyMenuRef.current.contains(e.target as Node)) {
        setNearbyMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [nearbyMenuOpen]);

  // Nearby routes: routes from nearby stops that aren't already subscribed
  const nearbyRoutes = useMemo(() => {
    if (!nearbyStops || !showNearbyRoutes) return [];
    const routeMap = new Map<string, Route>();
    const subscribedIds = new Set(subscribedRoutes.map((r) => r.gtfsId));
    for (const stop of nearbyStops) {
      for (const r of stop.routes) {
        if (!routeMap.has(r.gtfsId) && !subscribedIds.has(r.gtfsId)) {
          routeMap.set(r.gtfsId, { gtfsId: r.gtfsId, shortName: r.shortName, longName: r.longName, mode: r.mode });
        }
      }
    }
    return Array.from(routeMap.values()).sort((a, b) => {
      const aNum = parseInt(a.shortName, 10);
      const bNum = parseInt(b.shortName, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.shortName.localeCompare(b.shortName);
    });
  }, [nearbyStops, showNearbyRoutes, subscribedRoutes]);

  // Fetch route patterns for subscribed routes + temporarily activated routes + nearby routes
  const nearbyRouteIds = useMemo(
    () => nearbyRoutes.map((r) => r.gtfsId),
    [nearbyRoutes],
  );

  // Subscribe to MQTT for nearby routes when they change
  const nearbyMqttRouteIds = useRef(new Set<string>());
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
    // Include selected route if not already subscribed
    if (selectedRouteId) ids.add(selectedRouteId);
    // Include stop routes if a stop is selected
    for (const id of selectedStopRouteIds) ids.add(id);
    // Include nearby routes when enabled
    for (const id of nearbyRouteIds) ids.add(id);
    return Array.from(ids);
  }, [subscribedRoutes, selectedRouteId, selectedStopRouteIds, nearbyRouteIds]);
  const { data: patterns } = useRoutePatterns(routeIds);

  return (
    <div className="h-full w-full relative bg-gray-100 dark:bg-gray-950">
      {/* Map */}
      <BusMap
        patterns={patterns}
        onSubscribe={handleSubscribeRoute}
        onUnsubscribe={handleUnsubscribe}
        nearbyRadius={anyNearbyActive ? nearbyRadius : undefined}
        selectedVehicleId={selectedVehicleId}
        onVehicleSelect={setSelectedVehicleId}
        selectedRouteId={selectedRouteId}
        activatedRoute={activatedRoute}
        onRouteSelect={clearRouteSelection}
        bottomPadding={sheetHeight}
        nearbyStops={nearbyStops}
        onStopClick={handleStopClick}
        onStopDeselect={handleStopBack}
        nearbyRouteIds={nearbyRouteIds}
      />

      {/* Status bar with search */}
      <StatusBar onActivateRoute={handleActivateRoute} onToggleRouteSubscription={handleSelectRoute} nearbyStops={nearbyStops} onStopClick={handleStopClick} />

      {/* Settings button - top right */}
      <div className="fixed right-4 z-30" style={{ top: FAB_TOP_OFFSET }}>
        <FloatingActionButton
          icon={<SettingsIcon />}
          onClick={() => setIsSettingsOpen(true)}
          label="Settings"
        />
      </div>

      {/* Locate me button - bottom right, moves with bottom sheet */}
      <motion.div
        className="fixed right-4 z-30"
        style={{ bottom: fabBottom }}
      >
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
        header={
          <div className="flex items-center gap-2 mb-3 pt-1">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1 min-w-0">
              <button
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'vehicles'
                    ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => switchTab('vehicles')}
              >
                Vehicles
              </button>
              <button
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'routes'
                    ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => switchTab('routes')}
              >
                Routes
              </button>
              <button
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'stops'
                    ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => switchTab('stops')}
              >
                Stops
              </button>
            </div>
            <div className="relative shrink-0" ref={nearbyMenuRef}>
              <button
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  anyNearbyActive
                    ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => setNearbyMenuOpen(!nearbyMenuOpen)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Nearby
              </button>
              {nearbyMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
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
                </div>
              )}
            </div>
          </div>
        }
      >
        <div className="pb-8 pt-0.5">
          {/* Tab content */}
          {activeTab === 'vehicles' ? (
            <VehicleList
              selectedVehicleId={selectedVehicleId}
              onVehicleClick={(v) => {
                clearRouteSelection(null);
                clearSelectedStop();
                cleanupTempSubscriptions();
                setSelectedVehicleId(v.vehicleId);
              }}
              onSubscribe={handleSubscribeFromVehicle}
              onUnsubscribe={handleUnsubscribe}
            />
          ) : activeTab === 'routes' ? (
            <>
              <RoutesList
                routes={subscribedRoutes}
                patterns={patterns}
                onUnsubscribe={handleUnsubscribe}
                onRouteClick={(route) => {
                  setSelectedVehicleId(null);
                  clearSelectedStop();
                  cleanupTempSubscriptions();
                  setSelectedRouteId(route.gtfsId);
                  setActivatedRoute(route);
                }}
                selectedRouteId={selectedRouteId}
                hasNearbyRoutes={nearbyRoutes.length > 0}
              />
              {showNearbyRoutes && nearbyRoutes.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">Nearby Routes</h3>
                  <div className="space-y-2 px-0.5">
                    {nearbyRoutes.map((route) => {
                      const color = TRANSPORT_COLORS[route.mode ?? 'bus'] ?? TRANSPORT_COLORS.bus;
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
                          <button
                            className="shrink-0 w-8 h-8 min-[425px]:w-10 min-[425px]:h-10 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex items-center justify-center hover:bg-primary-100 dark:hover:bg-primary-900 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSubscribeRoute(route);
                            }}
                            title="Track this route"
                          >
                            <svg className="w-4 h-4 min-[425px]:w-5 min-[425px]:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : selectedStop ? (
            <StopDetails
              stop={selectedStop}
              onBack={handleStopBack}
              onDepartureClick={handleDepartureClick}
            />
          ) : (
            <NearbyStops
              stops={nearbyStops ?? []}
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
  patterns?: Map<string, RoutePattern[]>;
  onUnsubscribe: (gtfsId: string) => void;
  onRouteClick?: (route: SubscribedRoute) => void;
  selectedRouteId?: string | null;
  hasNearbyRoutes?: boolean;
}

const RoutesList = ({ routes, patterns, onUnsubscribe, onRouteClick, selectedRouteId, hasNearbyRoutes }: RoutesListProps) => {
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
    <div className="space-y-2 px-0.5 py-0.5">
      <AnimatePresence mode="popLayout" initial={false}>
        {routes.map((route) => {
          const color = route.color || TRANSPORT_COLORS[route.mode] || TRANSPORT_COLORS.bus;
          const isSelected = selectedRouteId === route.gtfsId;
          const routePatterns = patterns?.get(route.gtfsId);
          const vehicleCount = routePatterns?.reduce((acc, p) => acc + (p.geometry.length > 0 ? 1 : 0), 0) || 0;
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
                <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                  {route.mode} {vehicleCount > 0 && `• ${vehicleCount} direction${vehicleCount > 1 ? 's' : ''}`}
                </div>
              </div>
              <ConfirmDeleteButton
                onConfirm={() => onUnsubscribe(route.gtfsId)}
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
