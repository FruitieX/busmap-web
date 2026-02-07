import { useRef, useCallback, useMemo, memo, useEffect } from 'react';
import Map, { Marker, Source, Layer, AttributionControl } from 'react-map-gl/maplibre';
import type { LineLayerSpecification, MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import { AnimatePresence } from 'framer-motion';
import { useLocationStore, useVehicleStore, useSubscriptionStore, useSettingsStore } from '@/stores';
import { VehicleMarker, useAnimatedPosition, extrapolate } from './VehicleMarker';
import { VehiclePopover } from './VehiclePopover';
import { RoutePopover } from './RoutePopover';
import type { TrackedVehicle, RoutePattern, Route } from '@/types';
import type { FeatureCollection, LineString, Polygon } from 'geojson';
import { TOP_BAR_HEIGHT } from '@/constants';

import { MAP_STYLES } from '@/types';

// Popover height based on screen width (matches Tailwind sm: breakpoint at 640px)
const getPopoverHeight = (screenWidth: number) => screenWidth < 640 ? 170 : 200;

// Compute bounding box from route patterns
const computeRouteBounds = (routePatterns: RoutePattern[]): [[number, number], [number, number]] | null => {
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  for (const pattern of routePatterns) {
    for (const point of pattern.geometry) {
      minLng = Math.min(minLng, point.lon);
      maxLng = Math.max(maxLng, point.lon);
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
    }
  }

  if (minLng === Infinity) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
};

interface BusMapProps {
  patterns?: Map<string, RoutePattern[]>;
  onVehicleClick?: (vehicle: TrackedVehicle) => void;
  onSubscribe?: (route: Route) => void;
  onUnsubscribe?: (gtfsId: string) => void;
  nearbyRadius?: number; // in meters, shown as overlay when defined
  selectedVehicleId?: string | null;
  onVehicleSelect?: (vehicleId: string | null) => void;
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string | null) => void;
  bottomPadding?: number; // in pixels, for bottom sheet
}

const routeLineStyle: LineLayerSpecification = {
  id: 'route-lines',
  type: 'line',
  source: 'route-lines',
  paint: {
    'line-color': ['get', 'color'],
    'line-width': ['case', ['get', 'isSelected'], 8, 4],
    'line-opacity': ['case', ['get', 'isSelected'], 1, 0.6],
    'line-dasharray': [2, 2],
  },
  layout: {
    'line-cap': 'round',
    'line-join': 'round',
  },
};

// Generate a GeoJSON circle polygon (for flat rendering on 3D tilted maps)
const createCirclePolygon = (lng: number, lat: number, radiusMeters: number, points = 64): Polygon => {
  const coords: [number, number][] = [];
  // Earth radius at latitude
  const earthRadius = 6371000;
  const latRad = lat * Math.PI / 180;
  
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    // Calculate offset in degrees
    const dLat = (radiusMeters / earthRadius) * (180 / Math.PI) * Math.cos(angle);
    const dLng = (radiusMeters / (earthRadius * Math.cos(latRad))) * (180 / Math.PI) * Math.sin(angle);
    coords.push([lng + dLng, lat + dLat]);
  }
  
  return {
    type: 'Polygon',
    coordinates: [coords],
  };
};

// Wrapper component that uses the animated position hook for smooth marker movement
const AnimatedMarker = memo(({ vehicle, onClick }: { vehicle: TrackedVehicle; onClick: (vehicle: TrackedVehicle) => void }) => {
  const pos = useAnimatedPosition(vehicle);
  return (
    <Marker
      longitude={pos.lng}
      latitude={pos.lat}
      anchor="center"
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        onClick(vehicle);
      }}
    >
      <VehicleMarker vehicle={vehicle} heading={pos.heading} />
    </Marker>
  );
});
AnimatedMarker.displayName = 'AnimatedMarker';

// Popover wrapper component that tracks animated position.
// Keyed by vehicleId so hooks reset on vehicle change.
const SelectedVehiclePopover = memo(({ vehicle, onClose, onSubscribe, onUnsubscribe }: {
  vehicle: TrackedVehicle;
  onClose: () => void;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
}) => {
  const pos = useAnimatedPosition(vehicle);
  return (
    <Marker
      longitude={pos.lng}
      latitude={pos.lat}
      anchor="bottom"
      style={{ zIndex: 10 }}
    >
      <VehiclePopover
        vehicle={vehicle}
        onClose={onClose}
        onSubscribe={onSubscribe}
        onUnsubscribe={onUnsubscribe}
      />
    </Marker>
  );
});
SelectedVehiclePopover.displayName = 'SelectedVehiclePopover';

const BusMapComponent = ({ patterns, onVehicleClick, onSubscribe, onUnsubscribe, nearbyRadius, selectedVehicleId, onVehicleSelect, selectedRouteId, onRouteSelect, bottomPadding = 200 }: BusMapProps) => {
  const mapRef = useRef<MapRef>(null);
  const { viewport, setViewport, pendingFlyTo, consumePendingFlyTo } = useLocationStore();
  const userLocation = useLocationStore((state) => state.userLocation);
  const lastKnownLocation = useLocationStore((state) => state.lastKnownLocation);
  const vehiclesMap = useVehicleStore((state) => state.vehicles);
  const vehicles = useMemo(() => Array.from(vehiclesMap.values()), [vehiclesMap]);
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const showRouteLines = useSettingsStore((state) => state.showRouteLines);
  const mapStyleUrl = useSettingsStore((state) => MAP_STYLES[state.mapStyle].url);

  // Selected vehicle - controlled externally via prop or internally
  const selectedVehicle = useMemo(() => {
    if (!selectedVehicleId) return null;
    return vehicles.find((v) => v.vehicleId === selectedVehicleId) || null;
  }, [selectedVehicleId, vehicles]);


  // Handle pending flyTo animations with padding for bottom sheet
  useEffect(() => {
    if (pendingFlyTo && mapRef.current) {
      const map = mapRef.current.getMap();
      if (map) {
        const duration = 1000;
        // Predict where the selected vehicle will be when the animation completes
        let center: [number, number] = [pendingFlyTo.longitude, pendingFlyTo.latitude];
        if (selectedVehicle && selectedVehicle.speed > 0.3) {
          const predicted = extrapolate(
            selectedVehicle.lat,
            selectedVehicle.lng,
            selectedVehicle.heading,
            selectedVehicle.reportedHeading ?? selectedVehicle.heading,
            selectedVehicle.speed,
            selectedVehicle.speedAcceleration ?? selectedVehicle.acceleration ?? 0,
            (Date.now() - selectedVehicle.lastPositionUpdate + duration) / 1000,
          );
          center = [predicted.lng, predicted.lat];
        }
        isAnimatingRef.current = true;
        mapRef.current.flyTo({
          center,
          zoom: pendingFlyTo.zoom,
          bearing: pendingFlyTo.bearing ?? map.getBearing(),
          pitch: pendingFlyTo.pitch ?? map.getPitch(),
          duration,
          padding: { top: TOP_BAR_HEIGHT, left: 0, right: 0, bottom: bottomPadding },
        });
        setTimeout(() => { isAnimatingRef.current = false; }, duration);
      }
      consumePendingFlyTo();
    }
  }, [pendingFlyTo, consumePendingFlyTo, bottomPadding, selectedVehicle]);



  // Keep selected vehicle centered on an interval
  const isAnimatingRef = useRef(false);
  const lastCenterTimeRef = useRef(0);

  const MAX_TRACKING_ZOOM = 16.5;

  useEffect(() => {
    if (!selectedVehicle || !mapRef.current) return;
    if (isAnimatingRef.current) return;

    const now = Date.now();
    if (now - lastCenterTimeRef.current < 1000) return;

    const map = mapRef.current.getMap();
    if (!map || !map.loaded()) return;

    lastCenterTimeRef.current = now;

    const duration = 1000;

    // Predict where the vehicle will be when the animation ends
    let center: [number, number] = [selectedVehicle.lng, selectedVehicle.lat];
    if (selectedVehicle.speed > 0.3) {
      const predicted = extrapolate(
        selectedVehicle.lat,
        selectedVehicle.lng,
        selectedVehicle.heading,
        selectedVehicle.reportedHeading ?? selectedVehicle.heading,
        selectedVehicle.speed,
        selectedVehicle.speedAcceleration ?? selectedVehicle.acceleration ?? 0,
        (now - selectedVehicle.lastPositionUpdate + duration) / 1000,
      );
      center = [predicted.lng, predicted.lat];
    }

    map.easeTo({
      center,
      zoom: Math.min(map.getZoom(), MAX_TRACKING_ZOOM),
      padding: { top: TOP_BAR_HEIGHT, left: 0, right: 0, bottom: bottomPadding },
      duration,
    });
  }, [selectedVehicle?.lng, selectedVehicle?.lat, bottomPadding]);

  // Auto-deselect vehicle on user-initiated pan/zoom
  const handleMoveStart = useCallback(
    (evt: ViewStateChangeEvent) => {
      if (selectedVehicleId && evt.originalEvent) {
        onVehicleSelect?.(null);
      }
    },
    [selectedVehicleId, onVehicleSelect]
  );

  const handleMove = useCallback(
    (evt: ViewStateChangeEvent) => {
      const { latitude, longitude, zoom, bearing, pitch } = evt.viewState;
      setViewport({ latitude, longitude, zoom, bearing, pitch });
    },
    [setViewport]
  );

  const handleVehicleClick = useCallback(
    (vehicle: TrackedVehicle) => {
      const newId = selectedVehicleId === vehicle.vehicleId ? null : vehicle.vehicleId;
      onVehicleSelect?.(newId);
      onVehicleClick?.(vehicle);
    },
    [selectedVehicleId, onVehicleSelect, onVehicleClick]
  );

  const handlePopoverSubscribe = useCallback(() => {
    if (!selectedVehicle) return;
    const route: Route = {
      gtfsId: `HSL:${selectedVehicle.routeId}`,
      shortName: selectedVehicle.routeShortName,
      longName: selectedVehicle.headsign,
      mode: selectedVehicle.mode,
    };
    onSubscribe?.(route);
  }, [selectedVehicle, onSubscribe]);

  const handlePopoverUnsubscribe = useCallback(() => {
    if (!selectedVehicle) return;
    onUnsubscribe?.(`HSL:${selectedVehicle.routeId}`);
  }, [selectedVehicle, onUnsubscribe]);

  // Get selected route data
  const selectedRoute = useMemo(() => {
    if (!selectedRouteId) return null;
    return subscribedRoutes.find((r) => r.gtfsId === selectedRouteId) || null;
  }, [selectedRouteId, subscribedRoutes]);

  // Calculate route popover position - center horizontally at top of route
  const routePopoverData = useMemo(() => {
    if (!selectedRouteId || !patterns) return null;
    const routePatterns = patterns.get(selectedRouteId);
    if (!routePatterns || routePatterns.length === 0) return null;

    const bounds = computeRouteBounds(routePatterns);
    if (!bounds) return null;

    const [[minLng, _minLat], [maxLng, maxLat]] = bounds;
    return {
      lng: (minLng + maxLng) / 2,
      lat: maxLat,
      anchor: 'bottom' as const,
    };
  }, [selectedRouteId, patterns]);

  const handleRouteUnsubscribe = useCallback(() => {
    if (!selectedRouteId) return;
    onUnsubscribe?.(selectedRouteId);
    onRouteSelect?.(null);
  }, [selectedRouteId, onUnsubscribe, onRouteSelect]);

  // Build GeoJSON for route lines
  const routeLinesGeoJson = useMemo((): FeatureCollection<LineString> => {
    if (!showRouteLines || !patterns) {
      return { type: 'FeatureCollection', features: [] };
    }

    const features: FeatureCollection<LineString>['features'] = [];

    for (const route of subscribedRoutes) {
      const routePatterns = patterns.get(route.gtfsId);
      if (!routePatterns) continue;
      const isSelected = selectedRouteId === route.gtfsId;

      for (const pattern of routePatterns) {
        if (pattern.geometry.length < 2) continue;

        features.push({
          type: 'Feature',
          properties: {
            routeId: route.gtfsId,
            color: route.color,
            isSelected,
          },
          geometry: {
            type: 'LineString',
            coordinates: pattern.geometry.map((p) => [p.lon, p.lat]),
          },
        });
      }
    }

    return { type: 'FeatureCollection', features };
  }, [patterns, subscribedRoutes, showRouteLines, selectedRouteId]);

  // Build GeoJSON for user location circles (flat on 3D tilted maps)
  const userCirclesGeoJson = useMemo((): FeatureCollection<Polygon> => {
    if (!userLocation) {
      return { type: 'FeatureCollection', features: [] };
    }

    const features: FeatureCollection<Polygon>['features'] = [];
    
    // Nearby radius circle (if active)
    if (nearbyRadius) {
      features.push({
        type: 'Feature',
        properties: { type: 'nearby' },
        geometry: createCirclePolygon(userLocation.longitude, userLocation.latitude, nearbyRadius),
      });
    }
    
    // Accuracy circle
    features.push({
      type: 'Feature',
      properties: { type: 'accuracy' },
      geometry: createCirclePolygon(userLocation.longitude, userLocation.latitude, userLocation.accuracy),
    });

    return { type: 'FeatureCollection', features };
  }, [userLocation, nearbyRadius]);

  // Close popover if vehicle disappears
  useEffect(() => {
    if (selectedVehicleId && !selectedVehicle) {
      onVehicleSelect?.(null);
    }
  }, [selectedVehicleId, selectedVehicle, onVehicleSelect]);

  // Helper to fit map to route bounds with popover padding
  const fitRouteBounds = useCallback((routePatterns: RoutePattern[]) => {
    if (!mapRef.current) return;
    
    const bounds = computeRouteBounds(routePatterns);
    if (!bounds) return;
    
    const [[minLng, minLat], [maxLng, maxLat]] = bounds;
    if (!isFinite(minLng) || !isFinite(minLat) || !isFinite(maxLng) || !isFinite(maxLat)) {
      return;
    }

    const map = mapRef.current.getMap();
    if (!map) return;

    const container = map.getContainer();
    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    
    const popoverHeight = getPopoverHeight(width);

    const padding = {
      top: popoverHeight + 40 + 10,
      bottom: bottomPadding / 2 - 100,
      left: 10,
      right: 10,
    };


    try {
      isAnimatingRef.current = true;
      mapRef.current.fitBounds(bounds, { 
        padding, 
        duration: 1000,
      });
      setTimeout(() => { isAnimatingRef.current = false; }, 1000);
    } catch {
      isAnimatingRef.current = false;
    }
  }, [bottomPadding]);

  // Fly to vehicle when selected from the map (no flyToLocation from list)
  useEffect(() => {
    if (!selectedVehicle || !mapRef.current) return;
    // If there's a pending flyTo (from list click), let that handle it
    if (pendingFlyTo) return;

    const duration = 500;
    // Predict where the vehicle will be when the animation completes
    let center: [number, number] = [selectedVehicle.lng, selectedVehicle.lat];
    if (selectedVehicle.speed > 0.3) {
      const predicted = extrapolate(
        selectedVehicle.lat,
        selectedVehicle.lng,
        selectedVehicle.heading,
        selectedVehicle.reportedHeading ?? selectedVehicle.heading,
        selectedVehicle.speed,
        selectedVehicle.speedAcceleration ?? selectedVehicle.acceleration ?? 0,
        (Date.now() - selectedVehicle.lastPositionUpdate + duration) / 1000,
      );
      center = [predicted.lng, predicted.lat];
    }

    isAnimatingRef.current = true;
    mapRef.current.flyTo({
      center,
      zoom: Math.min(Math.max(mapRef.current.getMap()?.getZoom() ?? 15, 15), MAX_TRACKING_ZOOM),
      duration,
      padding: { top: TOP_BAR_HEIGHT, left: 0, right: 0, bottom: bottomPadding },
    });
    setTimeout(() => { isAnimatingRef.current = false; }, 1000);
  }, [selectedVehicle?.vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit bounds when route is selected
  useEffect(() => {
    if (!selectedRouteId || !patterns) return;

    const routePatterns = patterns.get(selectedRouteId);
    if (routePatterns && routePatterns.length > 0) {
      fitRouteBounds(routePatterns);
    }
  }, [selectedRouteId, patterns, fitRouteBounds]);

  // Handle map click - clear selections
  const handleMapClick = useCallback(() => {
    onVehicleSelect?.(null);
    onRouteSelect?.(null);
  }, [onVehicleSelect, onRouteSelect]);

  // Initial viewport for uncontrolled mode - only used on mount
  const initialViewState = useMemo(() => ({
    latitude: viewport.latitude,
    longitude: viewport.longitude,
    zoom: viewport.zoom,
    bearing: viewport.bearing ?? 0,
    pitch: viewport.pitch ?? 0,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Map
      ref={mapRef}
      initialViewState={initialViewState}
      onMoveStart={handleMoveStart}
      onMoveEnd={handleMove}
      onClick={handleMapClick}
      mapStyle={mapStyleUrl}
      style={{ width: '100%', height: '100%' }}
      attributionControl={false}
      reuseMaps
    >
      {/* Route polylines */}
      <Source id="route-lines" type="geojson" data={routeLinesGeoJson}>
        <Layer {...routeLineStyle} />
      </Source>

      {/* User location circles */}
      <Source id="user-circles" type="geojson" data={userCirclesGeoJson}>
          {/* Nearby radius circle border (no fill) */}
          <Layer
            id="nearby-circle-border"
            type="line"
            filter={['==', ['get', 'type'], 'nearby']}
            paint={{
              'line-color': '#3b82f6',
              'line-opacity': 0.6,
              'line-width': 2,
              'line-dasharray': [4, 4],
            }}
          />
          {/* Accuracy circle fill */}
          <Layer
            id="accuracy-circle-fill"
            type="fill"
            filter={['==', ['get', 'type'], 'accuracy']}
            paint={{
              'fill-color': '#3b82f6',
              'fill-opacity': 0.15,
            }}
          />
          {/* Accuracy circle border */}
          <Layer
            id="accuracy-circle-border"
            type="line"
            filter={['==', ['get', 'type'], 'accuracy']}
            paint={{
              'line-color': '#3b82f6',
              'line-opacity': 0.3,
              'line-width': 1,
            }}
          />
        </Source>

      {/* Stored last location (greyed out, shown until actual location arrives) */}
      {!userLocation && lastKnownLocation && (
        <Marker
          longitude={lastKnownLocation.longitude}
          latitude={lastKnownLocation.latitude}
          anchor="center"
        >
          <div className="w-4 h-4 rounded-full bg-gray-400 border-2 border-white/50 shadow-lg opacity-50" />
        </Marker>
      )}

      {/* User location dot */}
      {userLocation && (
        <Marker
          longitude={userLocation.longitude}
          latitude={userLocation.latitude}
          anchor="center"
        >
          <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg" />
        </Marker>
      )}

      {/* Vehicle markers */}
      {vehicles.map((vehicle) => (
        <AnimatedMarker
          key={vehicle.vehicleId}
          vehicle={vehicle}
          onClick={handleVehicleClick}
        />
      ))}

      {/* Popovers rendered after vehicle markers for higher z-index */}
      {/* Vehicle popover - follows selected vehicle */}
      <AnimatePresence>
        {selectedVehicle && (
          <SelectedVehiclePopover
            key={selectedVehicle.vehicleId}
            vehicle={selectedVehicle}
            onClose={() => onVehicleSelect?.(null)}
            onSubscribe={handlePopoverSubscribe}
            onUnsubscribe={handlePopoverUnsubscribe}
          />
        )}
      </AnimatePresence>

      {/* Route popover - shows centered at top of route */}
      <AnimatePresence>
        {selectedRoute && routePopoverData && (
          <Marker
            longitude={routePopoverData.lng}
            latitude={routePopoverData.lat}
            anchor={routePopoverData.anchor}
            style={{ zIndex: 10 }}
          >
            <RoutePopover
              route={selectedRoute}
              patterns={patterns?.get(selectedRouteId!) || undefined}
              vehicles={vehicles}
              onClose={() => onRouteSelect?.(null)}
              onUnsubscribe={handleRouteUnsubscribe}
            />
          </Marker>
        )}
      </AnimatePresence>


      <AttributionControl position="bottom-right" compact={true} />
    </Map>
  );
};

export const BusMap = memo(BusMapComponent);
