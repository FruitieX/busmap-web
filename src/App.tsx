import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BusMap,
  VehicleList,
  BottomSheet,
  StatusBar,
  FloatingActionButton,
  SettingsPanel,
} from '@/components';
import {
  useSettingsStore,
  useSubscriptionStore,
  useLocationStore,
  useVehicleStore,
  requestUserLocation,
  watchUserLocation,
} from '@/stores';
import { mqttService, useRoutePatterns } from '@/lib';
import type { Route, TrackedVehicle, BoundingBox, SubscribedRoute, RoutePattern } from '@/types';
import { TRANSPORT_COLORS } from '@/types';


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

const ZoomInIcon = () => (
  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-full h-full">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const ZoomOutIcon = () => (
  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-full h-full">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
  </svg>
);



type SheetTab = 'vehicles' | 'routes';

const App = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SheetTab>('vehicles');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [sheetHeight, setSheetHeight] = useState(340); // Track bottom sheet height

  const showNearby = useSettingsStore((state) => state.showNearby);
  const nearbyRadius = useSettingsStore((state) => state.nearbyRadius);
  const setShowNearby = useSettingsStore((state) => state.setShowNearby);

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

  // Fetch route patterns for subscribed routes
  const routeIds = useMemo(() => subscribedRoutes.map((r) => r.gtfsId), [subscribedRoutes]);
  const { data: patterns } = useRoutePatterns(routeIds);

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

  // Get user location for nearby mode - only extract lat/lng to avoid spam from timestamp changes
  const userLocation = useLocationStore((state) => state.userLocation);
  const userCoords = useMemo(
    () => userLocation ? { lat: userLocation.latitude, lng: userLocation.longitude } : null,
    [userLocation?.latitude, userLocation?.longitude]
  );

  // Handle nearby mode - additive, shows vehicles near user location
  const markNearbyVehiclesForExit = useVehicleStore((state) => state.markNearbyVehiclesForExit);
  const clearNearbyVehicles = useVehicleStore((state) => state.clearNearbyVehicles);

  useEffect(() => {
    if (!showNearby) {
      mqttService.unsubscribeFromNearbyArea();
      mqttService.setNearbyFilter(null, 0);
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
    mqttService.setNearbyFilter(userCoords, debouncedRadius); // For client-side circular filtering
    mqttService.subscribeToNearbyArea(bounds);
  }, [showNearby, userCoords, debouncedRadius, markNearbyVehiclesForExit, clearNearbyVehicles]);

  // Handle route selection
  const handleSelectRoute = useCallback(
    (route: Route) => {
      const isSubscribed = subscribedRoutes.some((r) => r.gtfsId === route.gtfsId);
      if (isSubscribed) {
        unsubscribeFromRoute(route.gtfsId);
        mqttService.unsubscribeFromRoute(route.gtfsId);
      } else {
        subscribeToRoute(route);
        mqttService.subscribeToRoute(route.gtfsId);
      }
    },
    [subscribedRoutes, subscribeToRoute, unsubscribeFromRoute]
  );

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
      setSelectedRouteId(null);
      await requestUserLocation();
      flyToUserLocation();
    } catch (error) {
      console.error('Failed to get location:', error);
    }
  }, [flyToUserLocation]);

  // Handle zoom with animation
  const handleZoomIn = useCallback(() => {
    const { viewport, flyToLocation } = useLocationStore.getState();
    flyToLocation(viewport.latitude, viewport.longitude, Math.min(viewport.zoom + 1, 20));
  }, []);

  const handleZoomOut = useCallback(() => {
    const { viewport, flyToLocation } = useLocationStore.getState();
    flyToLocation(viewport.latitude, viewport.longitude, Math.max(viewport.zoom - 1, 1));
  }, []);

  return (
    <div className="h-full w-full relative bg-gray-100 dark:bg-gray-950">
      {/* Map */}
      <BusMap
        patterns={patterns}
        onSubscribe={handleSubscribeRoute}
        onUnsubscribe={handleUnsubscribe}
        nearbyRadius={showNearby ? nearbyRadius : undefined}
        selectedVehicleId={selectedVehicleId}
        onVehicleSelect={setSelectedVehicleId}
        selectedRouteId={selectedRouteId}
        onRouteSelect={setSelectedRouteId}
        bottomPadding={sheetHeight}
      />

      {/* Status bar with search */}
      <StatusBar onSelectRoute={handleSelectRoute} />

      {/* Floating action buttons - top right corner */}
      <div className="fixed right-4 z-30 flex flex-col gap-2" style={{ top: 72 }}>
        <FloatingActionButton
          icon={<ZoomInIcon />}
          onClick={handleZoomIn}
          label="Zoom in"
          size="sm"
        />
        <FloatingActionButton
          icon={<ZoomOutIcon />}
          onClick={handleZoomOut}
          label="Zoom out"
          size="sm"
        />
        <div className="h-2" />
<FloatingActionButton
          icon={<LocationIcon />}
          onClick={handleLocateMe}
          label="Go to my location"
        />
        <FloatingActionButton
          icon={<SettingsIcon />}
          onClick={() => setIsSettingsOpen(true)}
          label="Settings"
        />
      </div>

      {/* Bottom sheet with tabs */}
      <BottomSheet
        minHeight={80}
        maxHeight={500}
        defaultHeight={340}
        onHeightChange={(h) => { setSheetHeight(h); setBottomPadding(h); }}
        header={
          <div className="flex items-center gap-2 mb-3 pt-1">
            <button
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'vehicles'
                  ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              onClick={() => setActiveTab('vehicles')}
            >
              Vehicles
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'routes'
                  ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              onClick={() => setActiveTab('routes')}
            >
              Routes ({subscribedRoutes.length})
            </button>
            <div className="flex-1" />
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-600 dark:text-gray-400">Nearby</span>
              <div
                className={`relative w-10 h-6 rounded-full transition-colors ${
                  showNearby ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
                onClick={() => setShowNearby(!showNearby)}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    showNearby ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </div>
            </label>
          </div>
        }
      >
        <div className="pb-8 pt-0.5">
          {/* Tab content */}
          {activeTab === 'vehicles' ? (
            <VehicleList
              selectedVehicleId={selectedVehicleId}
              onVehicleClick={(v) => {
                setSelectedRouteId(null);
                setSelectedVehicleId(v.vehicleId);
              }}
              onSubscribe={handleSubscribeFromVehicle}
              onUnsubscribe={handleUnsubscribe}
            />
          ) : (
            <RoutesList
              routes={subscribedRoutes}
              patterns={patterns}
              onUnsubscribe={handleUnsubscribe}
              onRouteClick={(route) => {
                setSelectedVehicleId(null);
                setSelectedRouteId(route.gtfsId);
              }}
              selectedRouteId={selectedRouteId}
            />
          )}
        </div>
      </BottomSheet>

      {/* Settings panel */}
      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
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
}

const RoutesList = ({ routes, patterns, onUnsubscribe, onRouteClick, selectedRouteId }: RoutesListProps) => {
  if (routes.length === 0) {
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
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[200px]">
          Add routes to track them in real-time
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-0.5 py-0.5">
      <AnimatePresence mode="popLayout">
        {routes.map((route) => {
          const color = route.color || TRANSPORT_COLORS[route.mode] || TRANSPORT_COLORS.bus;
          const isSelected = selectedRouteId === route.gtfsId;
          const routePatterns = patterns?.get(route.gtfsId);
          const vehicleCount = routePatterns?.reduce((acc, p) => acc + (p.geometry.length > 0 ? 1 : 0), 0) || 0;
          return (
            <motion.div
              key={route.gtfsId}
              layout
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              className={`bg-gray-50 dark:bg-gray-800 rounded-xl p-2 min-[425px]:p-3 flex items-center gap-2 min-[425px]:gap-3 cursor-pointer transition-all hover:bg-gray-100 dark:hover:bg-gray-700 ${isSelected ? 'outline outline-2 outline-primary-500' : ''}`}
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
              <button
                className="group shrink-0 w-8 h-8 min-[425px]:w-10 min-[425px]:h-10 rounded-full bg-primary-100 dark:bg-primary-900 text-primary-600 dark:text-primary-400 flex items-center justify-center hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnsubscribe(route.gtfsId);
                }}
                title="Remove route"
              >
                <svg className="w-4 h-4 min-[425px]:w-5 min-[425px]:h-5 group-hover:hidden" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <svg className="w-4 h-4 min-[425px]:w-5 min-[425px]:h-5 hidden group-hover:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default App;
