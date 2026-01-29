import { useRef, useCallback, useMemo, memo, useEffect } from 'react';
import Map, { Marker, Source, Layer, AttributionControl } from 'react-map-gl/maplibre';
import type { LineLayerSpecification, MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import { AnimatePresence } from 'framer-motion';
import { useLocationStore, useVehicleStore, useSubscriptionStore, useSettingsStore } from '@/stores';
import { VehicleMarker } from './VehicleMarker';
import { VehiclePopover } from './VehiclePopover';
import { RoutePopover } from './RoutePopover';
import type { TrackedVehicle, RoutePattern, Route } from '@/types';
import type { FeatureCollection, LineString, Polygon } from 'geojson';

// Free OpenStreetMap-based tile style
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

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

const BusMapComponent = ({ patterns, onVehicleClick, onSubscribe, onUnsubscribe, nearbyRadius, selectedVehicleId, onVehicleSelect, selectedRouteId, onRouteSelect, bottomPadding = 200 }: BusMapProps) => {
  const mapRef = useRef<MapRef>(null);
  const { viewport, setViewport, pendingFlyTo, consumePendingFlyTo } = useLocationStore();
  const userLocation = useLocationStore((state) => state.userLocation);
  const vehiclesMap = useVehicleStore((state) => state.vehicles);
  const vehicles = useMemo(() => Array.from(vehiclesMap.values()), [vehiclesMap]);
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const showRouteLines = useSettingsStore((state) => state.showRouteLines);

  // Selected vehicle - controlled externally via prop or internally
  const selectedVehicle = useMemo(() => {
    if (!selectedVehicleId) return null;
    return vehicles.find((v) => v.vehicleId === selectedVehicleId) || null;
  }, [selectedVehicleId, vehicles]);

  // Calculate vehicle popover anchor based on screen position
  const vehiclePopoverAnchor = useMemo((): 'top' | 'bottom' => {
    if (!selectedVehicle || !mapRef.current) return 'bottom';
    const map = mapRef.current.getMap();
    if (!map) return 'bottom';
    
    const point = map.project([selectedVehicle.lng, selectedVehicle.lat]);
    // Guard against NaN from project (can happen during map initialization)
    if (!isFinite(point.y)) return 'bottom';
    // If vehicle is in upper ~150px of screen, show popover below
    return point.y < 150 ? 'top' : 'bottom';
  }, [selectedVehicle, viewport]);

  // Handle pending flyTo animations with padding for bottom sheet
  useEffect(() => {
    if (pendingFlyTo && mapRef.current) {
      const map = mapRef.current.getMap();
      if (map) {
        // Use padding option to offset for bottom sheet
        // This is more reliable than project/unproject which can return NaN
        // Always provide bearing/pitch (defaulting to current) to prevent Chrome from skipping animation
        mapRef.current.flyTo({
          center: [pendingFlyTo.longitude, pendingFlyTo.latitude],
          zoom: pendingFlyTo.zoom,
          bearing: pendingFlyTo.bearing ?? map.getBearing(),
          pitch: pendingFlyTo.pitch ?? map.getPitch(),
          duration: 1000,
          padding: { top: 0, left: 0, right: 0, bottom: bottomPadding },
        });
      }
      consumePendingFlyTo();
    }
  }, [pendingFlyTo, consumePendingFlyTo, bottomPadding]);

  // Update selected vehicle position if it exists
  const selectedVehiclePosition = useMemo(() => {
    return selectedVehicle;
  }, [selectedVehicle]);

  // Auto-follow selected vehicle when it approaches screen edge
  // Accounts for popover height (~200px) based on anchor position
  const POPOVER_HEIGHT = 200;
  
  // Track if map is currently animating to prevent stacking animations
  const isAnimatingRef = useRef(false);
  
  useEffect(() => {
    if (!selectedVehiclePosition || !mapRef.current) return;
    
    // Skip if already animating to prevent animation queue buildup
    if (isAnimatingRef.current) return;

    const map = mapRef.current.getMap();
    if (!map) return;
    
    // Check if map is in a good state
    if (!map.loaded()) return;

    // Get map container bounds
    const container = map.getContainer();
    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) return; // Map not yet rendered

    const point = map.project([selectedVehiclePosition.lng, selectedVehiclePosition.lat]);
    
    // Guard against NaN from project (can happen during map initialization)
    if (!isFinite(point.x) || !isFinite(point.y)) return;

    // Define edge margins - account for popover position
    const marginX = width * 0.2;
    // If popover is above (anchor=bottom), need more margin at top for popover
    // If popover is below (anchor=top), need more margin at bottom for popover + sheet
    const marginTop = vehiclePopoverAnchor === 'bottom' ? POPOVER_HEIGHT + 60 : 80;
    const marginBottom = vehiclePopoverAnchor === 'top' ? bottomPadding + POPOVER_HEIGHT + 40 : bottomPadding + 40;

    // Check if vehicle is outside safe zone and calculate offset to bring it just inside
    let offsetX = 0;
    let offsetY = 0;

    if (point.x < marginX) {
      offsetX = point.x - marginX; // negative - pan left
    } else if (point.x > width - marginX) {
      offsetX = point.x - (width - marginX); // positive - pan right
    }

    if (point.y < marginTop) {
      offsetY = point.y - marginTop; // negative - pan up
    } else if (point.y > height - marginBottom) {
      offsetY = point.y - (height - marginBottom); // positive - pan down
    }

    if (offsetX !== 0 || offsetY !== 0) {
      // Pan by the offset amount (just enough to bring vehicle within bounds)
      map.panBy([offsetX, offsetY], { duration: 500 });
    }
  }, [selectedVehiclePosition?.lng, selectedVehiclePosition?.lat, bottomPadding, vehiclePopoverAnchor]);

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

    // Calculate route bounds
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

    // Position at center X, top Y (with anchor at bottom so popover appears above)
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

  // Fit bounds to selected route - accounts for popover at top
  useEffect(() => {
    if (!selectedRouteId || !patterns || !mapRef.current) return;
    
    const routePatterns = patterns.get(selectedRouteId);
    if (!routePatterns || routePatterns.length === 0) return;

    // Calculate bounds from all pattern geometries
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

    if (minLng === Infinity) return;

    // Large top padding for popover which appears at top of route
    mapRef.current.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: { top: POPOVER_HEIGHT + 80, left: 40, right: 40, bottom: bottomPadding + 40 }, duration: 1000 }
    );
  }, [selectedRouteId, patterns, bottomPadding]);

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
      onMoveEnd={handleMove}
      onClick={handleMapClick}
      mapStyle={MAP_STYLE}
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
        <Marker
          key={vehicle.vehicleId}
          longitude={vehicle.lng}
          latitude={vehicle.lat}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            handleVehicleClick(vehicle);
          }}
        >
          <VehicleMarker vehicle={vehicle} />
        </Marker>
      ))}

      {/* Popovers rendered after vehicle markers for higher z-index */}
      {/* Vehicle popover - follows selected vehicle */}
      <AnimatePresence>
        {selectedVehiclePosition && (
          <Marker
            key={`vehicle-popover-${vehiclePopoverAnchor}`}
            longitude={selectedVehiclePosition.lng}
            latitude={selectedVehiclePosition.lat}
            anchor={vehiclePopoverAnchor}
            style={{ zIndex: 10 }}
          >
            <VehiclePopover
              vehicle={selectedVehiclePosition}
              anchor={vehiclePopoverAnchor}
              onClose={() => onVehicleSelect?.(null)}
              onSubscribe={handlePopoverSubscribe}
              onUnsubscribe={handlePopoverUnsubscribe}
            />
          </Marker>
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
