import { useRef, useCallback, useMemo, memo, useEffect, useState } from 'react';
import Map, { Marker, Source, Layer, AttributionControl } from 'react-map-gl/maplibre';
import type { LineLayerSpecification, CircleLayerSpecification, SymbolLayerSpecification, MapRef, ViewStateChangeEvent, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import { AnimatePresence } from 'framer-motion';
import { useLocationStore, useVehicleStore, useSubscriptionStore, useSettingsStore, useStopStore, useSubscribedStopStore } from '@/stores';
import { useAnimatedPosition } from './VehicleMarker';
import { extrapolate, interpolateVehicle, pruneInterpolationStates } from '@/lib/interpolation';
import { VehiclePopover } from './VehiclePopover';
import { RoutePopover } from './RoutePopover';
import { StopPopover } from './StopPopover';
import type { TrackedVehicle, RoutePattern, Route, Stop } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import type { FeatureCollection, LineString, Polygon, Point, Feature } from 'geojson';
import { TOP_BAR_HEIGHT, getVehicleTiming } from '@/constants';

import { MAP_STYLES } from '@/types';

// Create arrow image for vehicle heading indicator (triangle shape)
// Takes a fill color and creates an arrow with white outline
const createArrowImage = (fillColor: string): ImageData => {
  const size = 64; // Higher resolution for crisp rendering
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Clear canvas (fully transparent)
  ctx.clearRect(0, 0, size, size);

  // Draw arrow centered in canvas (for icon-anchor: 'center')
  ctx.translate(size / 2, size / 2);

  // Scale up the triangle for the larger canvas
  const scale = size / 16;

  // Triangle shape pointing up
  const drawTriangle = () => {
    ctx.beginPath();
    ctx.moveTo(0 * scale, -4 * scale); // top tip
    ctx.lineTo(8 * scale, 8 * scale); // bottom right
    ctx.lineTo(-8 * scale, 8 * scale); // bottom left
    ctx.closePath();
  };

  // White outline (draw first, wider)
  drawTriangle();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 15;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Fill with the vehicle color
  drawTriangle();
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
  return ctx.getImageData(0, 0, size, size);
};

// Track which arrow colors have been added to the map
const arrowImageColors = new Set<string>();

// Get arrow image name for a color
const getArrowImageName = (color: string) => `vehicle-arrow-${color.replace('#', '')}`;

// Track selection animation state per vehicle: { vehicleId: { selected: boolean, startTime: number } }
interface SelectionAnimState { selected: boolean; startTime: number }
const selectionAnimState: Record<string, SelectionAnimState> = {};
const SELECTION_ANIM_DURATION_MS = 200; // Duration of selection scale animation

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
  activatedRoute?: Route | null;
  onRouteSelect?: (routeId: string | null) => void;
  bottomPadding?: number; // in pixels, for bottom sheet
  nearbyStops?: Array<Stop & { distance: number }>;
  onStopClick?: (stop: Stop) => void;
  onStopDeselect?: () => void;
  onVehicleDeselect?: () => void;
  onRouteActivate?: (route: Route) => void;
  onBackToStop?: () => void;
  nearbyRouteIds?: string[];
}

const routeLineStyle: LineLayerSpecification = {
  id: 'route-lines',
  type: 'line',
  source: 'route-lines',
  paint: {
    'line-color': ['get', 'color'],
    'line-width': ['case', ['get', 'isSelected'], 8, 4],
    'line-opacity': ['get', 'opacity'],
    'line-dasharray': [2, 2],
  },
  layout: {
    'line-cap': 'round',
    'line-join': 'round',
  },
};

// Vehicle ping layer - animated ring for subscribed vehicles (per-vehicle timing)
const vehiclePingStyle: CircleLayerSpecification = {
  id: 'vehicle-ping',
  type: 'circle',
  source: 'vehicles',
  filter: ['>', ['get', 'pingOpacity'], 0],
  paint: {
    'circle-radius': ['get', 'pingRadius'],
    'circle-color': 'transparent',
    'circle-stroke-color': ['get', 'color'],
    'circle-stroke-width': 2,
    'circle-stroke-opacity': ['get', 'pingOpacity'],
  },
};

// Vehicle circle layer - main dot
const vehicleCircleStyle: CircleLayerSpecification = {
  id: 'vehicle-circles',
  type: 'circle',
  source: 'vehicles',
  layout: {
    'circle-sort-key': ['get', 'sortKey'],
  },
  paint: {
    'circle-radius': ['get', 'circleRadius'],
    'circle-color': ['get', 'color'],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': ['case', ['get', 'isSubscribed'], 2.5, 1.5],
    'circle-opacity': ['get', 'opacity'],
    'circle-stroke-opacity': ['get', 'opacity'],
  },
};

// Vehicle arrow layer - heading indicator (chevron above circle, rendered behind circle)
const vehicleArrowStyle: SymbolLayerSpecification = {
  id: 'vehicle-arrows',
  type: 'symbol',
  source: 'vehicles',
  layout: {
    'icon-image': ['get', 'arrowImage'],
    'icon-size': ['get', 'arrowSize'],
    'icon-rotate': ['get', 'heading'],
    'icon-rotation-alignment': 'map',
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
    'icon-anchor': 'center',
    'icon-offset': [0, -80], // Offset is multiplied by icon-size, so this gives ~25px at zoom 14
    'symbol-sort-key': ['get', 'sortKey'],
  },
  paint: {
    'icon-opacity': ['get', 'opacity'],
  },
};

// Vehicle label layer - route number text
const vehicleLabelStyle: SymbolLayerSpecification = {
  id: 'vehicle-labels',
  type: 'symbol',
  source: 'vehicles',
  layout: {
    'text-field': ['get', 'routeShortName'],
    'text-size': ['get', 'textSize'],
    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'symbol-sort-key': ['get', 'sortKey'],
  },
  paint: {
    'text-color': '#ffffff',
    'text-opacity': ['get', 'opacity'],
    'text-halo-color': 'rgba(0,0,0,0.3)',
    'text-halo-width': 1,
  },
};

interface VehicleFeatureProps {
  vehicleId: string;
  routeShortName: string;
  color: string;
  arrowImage: string;
  opacity: number;
  heading: number;
  isSubscribed: boolean;
  isSelected: boolean;
  pingRadius: number;
  pingOpacity: number;
  circleRadius: number;
  arrowSize: number;
  textSize: number;
  sortKey: number;
}

// Generate a GeoJSON circle polygon (for flat rendering on 3D tilted maps)
const createCirclePolygon = (lng: number, lat: number, radiusMeters: number, points = 32): Polygon => {
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
      offset={[0, -25]} // Offset upward to avoid obscuring vehicle marker and heading arrow
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

const BusMapComponent = ({ patterns, onVehicleClick, onSubscribe, onUnsubscribe, nearbyRadius, selectedVehicleId, onVehicleSelect, selectedRouteId, activatedRoute, onRouteSelect, bottomPadding = 200, nearbyStops, onStopClick, onStopDeselect, onVehicleDeselect, onRouteActivate, onBackToStop, nearbyRouteIds }: BusMapProps) => {
  const mapRef = useRef<MapRef>(null);
  const { viewport, setViewport, pendingFlyTo, consumePendingFlyTo } = useLocationStore();
  const userLocation = useLocationStore((state) => state.userLocation);
  const lastKnownLocation = useLocationStore((state) => state.lastKnownLocation);
  const vehiclesMap = useVehicleStore((state) => state.vehicles);
  const vehicles = useMemo(() => Array.from(vehiclesMap.values()), [vehiclesMap]);
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const showRouteLines = useSettingsStore((state) => state.showRouteLines);
  const showStops = useSettingsStore((state) => state.showStops);
  const mapStyleUrl = useSettingsStore((state) => MAP_STYLES[state.mapStyle].url);

  // Stop store
  const selectedStop = useStopStore((state) => state.selectedStop);
  const selectedStopRouteIds = useStopStore((state) => state.selectedStopRouteIds);
  const selectedStopDirections = useStopStore((state) => state.selectedStopDirections);

  // Subscribed stops (always shown on map)
  const subscribedStops = useSubscribedStopStore((state) => state.subscribedStops);

  // Selected vehicle - controlled externally via prop or internally
  const selectedVehicle = useMemo(() => {
    if (!selectedVehicleId) return null;
    return vehicles.find((v) => v.vehicleId === selectedVehicleId) || null;
  }, [selectedVehicleId, vehicles]);

  // Pre-compute subscribed route IDs for O(1) lookup
  const subscribedRouteIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of subscribedRoutes) {
      ids.add(r.gtfsId);
      ids.add(r.shortName);
    }
    return ids;
  }, [subscribedRoutes]);

  // Map from route to color for quick lookup
  const routeColorMap = useMemo(() => {
    const colorMap: Record<string, string> = {};
    for (const r of subscribedRoutes) {
      colorMap[r.gtfsId] = r.color;
      colorMap[r.shortName] = r.color;
    }
    return colorMap;
  }, [subscribedRoutes]);

  // Vehicle GeoJSON for WebGL layer - updated by rAF loop
  const [vehicleGeoJson, setVehicleGeoJson] = useState<FeatureCollection<Point, VehicleFeatureProps>>({
    type: 'FeatureCollection',
    features: [],
  });

  // Animate vehicles with a single shared rAF loop
  const animateVehicles = useSettingsStore((state) => state.animateVehicles);
  const rafRef = useRef<number>(0);
  const vehiclesRef = useRef<TrackedVehicle[]>(vehicles);
  vehiclesRef.current = vehicles;

  // Add arrow image to map for a specific color
  const addArrowImageForColor = useCallback((color: string) => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const imageName = getArrowImageName(color);
    if (!map.hasImage(imageName)) {
      const imageData = createArrowImage(color);
      map.addImage(imageName, imageData, { sdf: false });
      arrowImageColors.add(color);
    }
  }, []);

  // Clear arrow image tracking on style changes (images are removed when style changes)
  const handleStyleLoad = useCallback(() => {
    arrowImageColors.clear();
  }, []);

  // Handle map load
  const handleMapLoad = useCallback(() => {
    // Arrow images will be added dynamically as vehicles appear
  }, []);

  // Re-register style load handler
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    
    map.on('style.load', handleStyleLoad);
    
    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [handleStyleLoad]);

  // Track selected vehicle ID in ref for rAF loop
  const selectedVehicleIdRef = useRef<string | null | undefined>(selectedVehicleId);
  selectedVehicleIdRef.current = selectedVehicleId;

  // Track selected route ID in ref for rAF loop
  const selectedRouteIdRef = useRef<string | null | undefined>(selectedRouteId);
  selectedRouteIdRef.current = selectedRouteId;

  // Track selected stop route IDs in ref for rAF loop
  const selectedStopRouteIdsRef = useRef<Set<string>>(selectedStopRouteIds);
  selectedStopRouteIdsRef.current = selectedStopRouteIds;

  // Track selected stop directions in ref for rAF loop
  const selectedStopDirectionsRef = useRef<Record<string, number[]>>(selectedStopDirections);
  selectedStopDirectionsRef.current = selectedStopDirections;

  // Track addArrowImageForColor in ref for rAF loop access
  const addArrowImageForColorRef = useRef(addArrowImageForColor);
  addArrowImageForColorRef.current = addArrowImageForColor;

  useEffect(() => {
    const PING_DURATION_MS = 750; // Duration of ping animation after update (matches typical 1s update rate)
    const PRUNE_INTERVAL_MS = 10_000;
    let lastPrune = 0;
    
    const animate = () => {
      const now = Date.now();
      
      const currentVehicles = vehiclesRef.current;
      const features: Feature<Point, VehicleFeatureProps>[] = [];
      const currentSelectedId = selectedVehicleIdRef.current;
      const currentSelectedRouteId = selectedRouteIdRef.current;
      const currentStopRouteIds = selectedStopRouteIdsRef.current;
      const currentStopDirections = selectedStopDirectionsRef.current;

      // Get current zoom for scaling
      const zoom = mapRef.current?.getMap()?.getZoom() ?? 14;
      // Scale factor: 1.0 at zoom 14, smaller when zoomed out, capped when zoomed in
      const zoomScale = Math.min(1.0, Math.pow(2, (zoom - 15) * 0.3));
      const baseRadius = 14 * zoomScale;
      const selectedScale = 18 / 14; // Ratio of selected to base radius
      const baseTextSize = 15 * zoomScale;
      const baseArrowSize = 0.25 * zoomScale; // Base size for 64px arrow icon

      // Scale text size based on label length: shorter labels get larger text
      const getTextSize = (label: string) => {
        const len = label.length;
        // 1 char: 120%, 2 chars: 100%, 3 chars: 85%, 4+ chars: 70%
        const labelScale = len === 1 ? 1.2 : len === 2 ? 1.0 : len === 3 ? 0.85 : 0.7;
        return Math.max(2, baseTextSize * labelScale);
      };

      // Periodically prune stale interpolation states to avoid memory leaks
      if (now - lastPrune > PRUNE_INTERVAL_MS) {
        lastPrune = now;
        const activeIds = new Set(currentVehicles.map((v) => v.vehicleId));
        pruneInterpolationStates(activeIds);
      }

      for (const vehicle of currentVehicles) {
        const timing = getVehicleTiming(vehicle.mode);

        // Calculate staleness
        const age = now - vehicle.lastUpdate;
        let staleness = 0;
        if (age > timing.fadeStartMs) {
          staleness = Math.min(1, (age - timing.fadeStartMs) / (timing.fadeEndMs - timing.fadeStartMs));
        }
        if (staleness >= 1) continue;

        // Calculate exit progress
        let exitProgress = 0;
        if (vehicle.exitingAt) {
          exitProgress = Math.min(1, (now - vehicle.exitingAt) / 300);
          if (exitProgress >= 1) continue;
        }

        // Base opacity from staleness and exit
        let opacity = (1 - staleness) * (1 - exitProgress);
        
        // Fade factor for vehicles not on the selected route or stop
        let routeFadeFactor = 1;
        if (currentSelectedRouteId) {
          const vehicleRouteId = `HSL:${vehicle.routeId}`;
          if (vehicleRouteId !== currentSelectedRouteId) {
            routeFadeFactor = 0.1; // Fade non-selected route vehicles
          }
        } else if (currentStopRouteIds.size > 0) {
          const vehicleRouteId = `HSL:${vehicle.routeId}`;
          if (!currentStopRouteIds.has(vehicleRouteId)) {
            routeFadeFactor = 0.1; // Fade vehicles not on stop's routes
          } else {
            // Check direction filtering (if timetable data has loaded)
            const allowedDirs = currentStopDirections[vehicleRouteId];
            if (allowedDirs && allowedDirs.length > 0 && !allowedDirs.includes(vehicle.direction)) {
              routeFadeFactor = 0.1; // Fade vehicles going in wrong direction
            }
          }
        }
        opacity *= routeFadeFactor;

        // Determine interpolated position and heading (extrapolation + smooth correction)
        let lat: number;
        let lng: number;
        let heading: number;

        if (animateVehicles) {
          const interpolated = interpolateVehicle(vehicle, now);
          lat = interpolated.lat;
          lng = interpolated.lng;
          heading = interpolated.heading;
        } else {
          lat = vehicle.lat;
          lng = vehicle.lng;
          heading = vehicle.heading;
        }

        // Determine color
        const isSubscribed = subscribedRouteIds.has(`HSL:${vehicle.routeId}`) || subscribedRouteIds.has(vehicle.routeShortName);
        const isSelected = vehicle.vehicleId === currentSelectedId;
        const color = routeColorMap[`HSL:${vehicle.routeId}`] 
          ?? routeColorMap[vehicle.routeShortName] 
          ?? TRANSPORT_COLORS[vehicle.mode] 
          ?? TRANSPORT_COLORS.bus;

        // Sort key: selected vehicle on top, then by latitude (north = back)
        // Higher sortKey = drawn later = on top
        const sortKey = isSelected ? 1000000 : Math.round((90 - lat) * 10000);

        // Animate selection scale
        let animState = selectionAnimState[vehicle.vehicleId];
        let selectionScale = 1;
        if (animState) {
          if (animState.selected !== isSelected) {
            // Selection state changed, start new animation
            animState = { selected: isSelected, startTime: now };
            selectionAnimState[vehicle.vehicleId] = animState;
          }
          const elapsed = now - animState.startTime;
          const progress = Math.min(1, elapsed / SELECTION_ANIM_DURATION_MS);
          // Ease out cubic for smooth deceleration
          const eased = 1 - Math.pow(1 - progress, 3);
          if (animState.selected) {
            // Animating to selected (scale up)
            selectionScale = 1 + (selectedScale - 1) * eased;
          } else {
            // Animating to deselected (scale down)
            selectionScale = selectedScale - (selectedScale - 1) * eased;
          }
        } else {
          // First time seeing this vehicle, set initial state
          selectionAnimState[vehicle.vehicleId] = { selected: isSelected, startTime: now - SELECTION_ANIM_DURATION_MS };
          selectionScale = isSelected ? selectedScale : 1;
        }

        // Per-vehicle ping animation - triggered by lastUpdate, fades over PING_DURATION_MS
        // Show for all vehicles (subscribed and nearby)
        let pingRadius = 0;
        let pingOpacity = 0;
        const timeSinceLastUpdate = now - vehicle.lastUpdate;
        if (timeSinceLastUpdate < PING_DURATION_MS) {
          const pingPhase = timeSinceLastUpdate / PING_DURATION_MS;
          pingRadius = (baseRadius * selectionScale + pingPhase * baseRadius * 0.8); // expands from scaled baseRadius
          pingOpacity = 0.6 * (1 - pingPhase) * routeFadeFactor; // fade out, also apply route fade
        }

        const circleRadius = baseRadius * selectionScale;
        const arrowSize = baseArrowSize * selectionScale;

        // Ensure arrow image exists for this color
        const arrowImage = getArrowImageName(color);
        if (!arrowImageColors.has(color)) {
          addArrowImageForColorRef.current(color);
        }

        features.push({
          type: 'Feature',
          properties: {
            vehicleId: vehicle.vehicleId,
            routeShortName: vehicle.routeShortName,
            color,
            arrowImage,
            opacity,
            heading,
            isSubscribed,
            isSelected,
            pingRadius,
            pingOpacity,
            circleRadius,
            arrowSize,
            textSize: getTextSize(vehicle.routeShortName),
            sortKey,
          },
          geometry: {
            type: 'Point',
            coordinates: [lng, lat],
          },
        });
      }

      setVehicleGeoJson({ type: 'FeatureCollection', features });
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animateVehicles, subscribedRouteIds, routeColorMap]);

  // Animation state refs - declared here before effects that use them
  const isAnimatingRef = useRef(false);
  const isProgrammaticMoveRef = useRef(false);

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


  const MAX_TRACKING_ZOOM = 16.5;

  // Store selected vehicle in ref for interval access
  const selectedVehicleRef = useRef<TrackedVehicle | null>(selectedVehicle);
  selectedVehicleRef.current = selectedVehicle;

  useEffect(() => {
    if (!selectedVehicleId) return;

    // Interval to keep vehicle centered - runs every second
    const intervalId = setInterval(() => {
      const vehicle = selectedVehicleRef.current;
      if (!vehicle || !mapRef.current) {
        return;
      }

      const map = mapRef.current.getMap();
      if (!map) {
        return;
      }

      const now = Date.now();
      const duration = 1000;

      // Predict where the vehicle will be when the animation ends
      let center: [number, number] = [vehicle.lng, vehicle.lat];
      if (vehicle.speed > 0.3) {
        const predicted = extrapolate(
          vehicle.lat,
          vehicle.lng,
          vehicle.heading,
          vehicle.reportedHeading ?? vehicle.heading,
          vehicle.speed,
          vehicle.speedAcceleration ?? vehicle.acceleration ?? 0,
          (now - vehicle.lastPositionUpdate + duration) / 1000,
        );
        center = [predicted.lng, predicted.lat];
      }

      // Mark as programmatic movement to prevent deselection
      isProgrammaticMoveRef.current = true;
      map.easeTo({
        center,
        zoom: Math.min(map.getZoom(), MAX_TRACKING_ZOOM),
        padding: { top: TOP_BAR_HEIGHT, left: 0, right: 0, bottom: bottomPadding },
        duration,
      });
      // Reset after animation completes
      setTimeout(() => { isProgrammaticMoveRef.current = false; }, duration);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [selectedVehicleId, bottomPadding]);

  // Auto-deselect vehicle on user-initiated pan/zoom
  const handleMoveStart = useCallback(
    (evt: ViewStateChangeEvent) => {
      // Only deselect on user-initiated moves (has originalEvent) and not during programmatic tracking
      if (selectedVehicleId && evt.originalEvent && !isProgrammaticMoveRef.current) {
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

  // Handle click on vehicle WebGL layer
  const handleVehicleLayerClick = useCallback(
    (evt: MapLayerMouseEvent) => {
      if (!evt.features || evt.features.length === 0) return;
      const feature = evt.features[0];
      const vehicleId = feature.properties?.vehicleId;
      if (!vehicleId) return;

      const vehicle = vehiclesRef.current.find((v) => v.vehicleId === vehicleId);
      if (vehicle) {
        evt.originalEvent.stopPropagation();
        handleVehicleClick(vehicle);
      }
    },
    [handleVehicleClick]
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

  // Get selected route data (subscribed or from nearby stops / vehicles)
  const selectedRoute = useMemo((): Route | null => {
    if (!selectedRouteId) return null;
    // Check subscribed routes first
    const subscribed = subscribedRoutes.find((r) => r.gtfsId === selectedRouteId);
    if (subscribed) return subscribed;
    // Try to find from nearby stops
    if (nearbyStops) {
      for (const stop of nearbyStops) {
        const stopRoute = stop.routes.find((r) => r.gtfsId === selectedRouteId);
        if (stopRoute) return { ...stopRoute };
      }
    }
    // Fall back to vehicle data
    const vehicle = vehicles.find((v) => `HSL:${v.routeId}` === selectedRouteId);
    if (vehicle) {
      return {
        gtfsId: selectedRouteId,
        shortName: vehicle.routeShortName,
        longName: vehicle.headsign,
        mode: vehicle.mode,
      };
    }
    // Fall back to activated route from search/list
    if (activatedRoute && activatedRoute.gtfsId === selectedRouteId) {
      return activatedRoute;
    }
    return null;
  }, [selectedRouteId, subscribedRoutes, nearbyStops, vehicles, activatedRoute]);

  const isSelectedRouteSubscribed = useMemo(
    () => selectedRouteId ? subscribedRoutes.some((r) => r.gtfsId === selectedRouteId) : false,
    [selectedRouteId, subscribedRoutes]
  );

  // Calculate route popover position - center horizontally at top of route
  const routePopoverData = useMemo(() => {
    if (!selectedRouteId || !patterns) return null;
    const routePatterns = patterns.get(selectedRouteId);
    if (!routePatterns || routePatterns.length === 0) return null;

    const bounds = computeRouteBounds(routePatterns);
    if (!bounds) return null;

    const [[minLng], [maxLng, maxLat]] = bounds;
    return {
      lng: (minLng + maxLng) / 2,
      lat: maxLat,
      anchor: 'bottom' as const,
    };
  }, [selectedRouteId, patterns]);

  const handleRouteUnsubscribe = useCallback(() => {
    if (!selectedRouteId) return;
    if (subscribedRoutes.some((r) => r.gtfsId === selectedRouteId)) {
      onUnsubscribe?.(selectedRouteId);
    }
  }, [selectedRouteId, subscribedRoutes, onUnsubscribe]);

  const handleRouteSubscribe = useCallback(() => {
    if (!selectedRoute || !selectedRouteId) return;
    onSubscribe?.({
      gtfsId: selectedRoute.gtfsId,
      shortName: selectedRoute.shortName,
      longName: selectedRoute.longName,
      mode: selectedRoute.mode,
    });
  }, [selectedRoute, selectedRouteId, onSubscribe]);

  // Build GeoJSON for route lines
  const routeLinesGeoJson = useMemo((): FeatureCollection<LineString> => {
    if (!showRouteLines || !patterns) {
      return { type: 'FeatureCollection', features: [] };
    }

    const features: FeatureCollection<LineString>['features'] = [];

    // Track which route IDs have already been rendered
    const renderedRouteIds = new Set<string>();

    // Render subscribed routes
    for (const route of subscribedRoutes) {
      const routePatterns = patterns.get(route.gtfsId);
      if (!routePatterns) continue;
      renderedRouteIds.add(route.gtfsId);
      const isSelected = selectedRouteId === route.gtfsId;
      
      // When a route or stop is selected, fade out other routes
      let opacity = isSelected ? 1 : 0.6;
      if (selectedRouteId && !isSelected) {
        opacity = 0.1; // Fade non-selected routes when one is selected
      } else if (selectedStopRouteIds.size > 0) {
        opacity = selectedStopRouteIds.has(route.gtfsId) ? 1 : 0.1;
      }

      for (const pattern of routePatterns) {
        if (pattern.geometry.length < 2) continue;

        features.push({
          type: 'Feature',
          properties: {
            routeId: route.gtfsId,
            color: route.color,
            isSelected,
            opacity,
          },
          geometry: {
            type: 'LineString',
            coordinates: pattern.geometry.map((p) => [p.lon, p.lat]),
          },
        });
      }
    }

    // Render temporarily activated routes (from selectedRouteId, selectedStopRouteIds, or nearbyRouteIds)
    const tempRouteIds = new Set<string>();
    if (selectedRouteId && !renderedRouteIds.has(selectedRouteId)) {
      tempRouteIds.add(selectedRouteId);
    }
    for (const id of selectedStopRouteIds) {
      if (!renderedRouteIds.has(id)) {
        tempRouteIds.add(id);
      }
    }
    if (nearbyRouteIds) {
      for (const id of nearbyRouteIds) {
        if (!renderedRouteIds.has(id)) {
          tempRouteIds.add(id);
        }
      }
    }

    for (const routeId of tempRouteIds) {
      const routePatterns = patterns.get(routeId);
      if (!routePatterns) continue;
      const isSelected = selectedRouteId === routeId;
      let opacity = isSelected ? 1 : 0.6;
      if (selectedRouteId && !isSelected) {
        opacity = 0.1;
      } else if (selectedStopRouteIds.size > 0) {
        opacity = selectedStopRouteIds.has(routeId) ? 1 : 0.1;
      }
      // Resolve color from nearby stops, activated route, or default
      let color = TRANSPORT_COLORS.bus;
      if (activatedRoute && routeId === activatedRoute.gtfsId && activatedRoute.mode) {
        color = TRANSPORT_COLORS[activatedRoute.mode] ?? TRANSPORT_COLORS.bus;
      } else if (nearbyStops) {
        for (const stop of nearbyStops) {
          const sr = stop.routes.find((r) => r.gtfsId === routeId);
          if (sr) {
            color = TRANSPORT_COLORS[sr.mode] ?? TRANSPORT_COLORS.bus;
            break;
          }
        }
      }

      for (const pattern of routePatterns) {
        if (pattern.geometry.length < 2) continue;

        features.push({
          type: 'Feature',
          properties: {
            routeId,
            color,
            isSelected,
            opacity,
          },
          geometry: {
            type: 'LineString',
            coordinates: pattern.geometry.map((p) => [p.lon, p.lat]),
          },
        });
      }
    }

    return { type: 'FeatureCollection', features };
  }, [patterns, subscribedRoutes, showRouteLines, selectedRouteId, selectedStopRouteIds, nearbyStops, nearbyRouteIds, activatedRoute]);

  // Build GeoJSON for stop markers
  // Always show the selected stop and subscribed stops, even if showStops is off
  const stopsGeoJson = useMemo((): FeatureCollection<Point> => {
    // Collect all stops to show, deduplicating by gtfsId
    const stopById: Record<string, Stop> = {};

    // Always include selected stop
    if (selectedStop) {
      stopById[selectedStop.gtfsId] = selectedStop;
    }

    // Always include subscribed stops
    for (const sub of subscribedStops) {
      if (!(sub.gtfsId in stopById)) {
        stopById[sub.gtfsId] = {
          gtfsId: sub.gtfsId,
          name: sub.name,
          code: sub.code,
          lat: sub.lat,
          lon: sub.lon,
          vehicleMode: sub.vehicleMode,
          routes: [],
        };
      }
    }

    // Include nearby stops when showStops is on
    if (showStops && nearbyStops) {
      for (const stop of nearbyStops) {
        if (!(stop.gtfsId in stopById)) {
          stopById[stop.gtfsId] = stop;
        }
      }
    }

    const stopsToShow = Object.values(stopById);

    if (stopsToShow.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }

    return {
      type: 'FeatureCollection',
      features: stopsToShow.map((stop) => ({
        type: 'Feature' as const,
        properties: {
          gtfsId: stop.gtfsId,
          name: stop.name,
          code: stop.code,
          vehicleMode: stop.vehicleMode,
          isSelected: selectedStop?.gtfsId === stop.gtfsId,
          color: TRANSPORT_COLORS[stop.vehicleMode] ?? TRANSPORT_COLORS.bus,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [stop.lon, stop.lat],
        },
      })),
    };
  }, [showStops, nearbyStops, selectedStop, subscribedStops]);

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
    if (selectedStop) onStopDeselect?.();
  }, [onVehicleSelect, onRouteSelect, onStopDeselect, selectedStop]);

  // Handle click on route line layer
  const handleRouteLineClick = useCallback(
    (evt: MapLayerMouseEvent) => {
      if (!evt.features || evt.features.length === 0) return;
      const feature = evt.features[0];
      const routeId = feature.properties?.routeId as string | undefined;
      if (!routeId) return;

      // Resolve full route info
      const subscribed = subscribedRoutes.find((r) => r.gtfsId === routeId);
      if (subscribed) {
        evt.originalEvent.stopPropagation();
        onRouteActivate?.(subscribed);
        return;
      }
      // Try nearby stops
      if (nearbyStops) {
        for (const stop of nearbyStops) {
          const sr = stop.routes.find((r) => r.gtfsId === routeId);
          if (sr) {
            evt.originalEvent.stopPropagation();
            onRouteActivate?.({ gtfsId: sr.gtfsId, shortName: sr.shortName, longName: sr.longName, mode: sr.mode as Route['mode'] });
            return;
          }
        }
      }
      // Fall back to activated route
      if (activatedRoute && activatedRoute.gtfsId === routeId) {
        evt.originalEvent.stopPropagation();
        onRouteActivate?.(activatedRoute);
      }
    },
    [subscribedRoutes, nearbyStops, activatedRoute, onRouteActivate]
  );

  // Handle click on stop WebGL layer
  const handleStopLayerClick = useCallback(
    (evt: MapLayerMouseEvent) => {
      if (!evt.features || evt.features.length === 0) return;
      const feature = evt.features[0];
      const stopId = feature.properties?.gtfsId;
      if (!stopId) return;

      // Search nearby stops first, then subscribed stops
      let stop: Stop | undefined;
      if (nearbyStops) {
        stop = nearbyStops.find((s) => s.gtfsId === stopId);
      }
      if (!stop) {
        const sub = subscribedStops.find((s) => s.gtfsId === stopId);
        if (sub) {
          stop = { ...sub, routes: [] };
        }
      }
      if (stop) {
        evt.originalEvent.stopPropagation();
        onStopClick?.(stop);
      }
    },
    [nearbyStops, subscribedStops, onStopClick]
  );

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
      onLoad={handleMapLoad}
      onMoveStart={handleMoveStart}
      onMoveEnd={handleMove}
      onClick={(e) => {
        // Check if clicked on a vehicle
        if (e.features && e.features.length > 0 && e.features[0].layer?.id === 'vehicle-circles') {
          handleVehicleLayerClick(e);
        } else if (e.features && e.features.length > 0 && (e.features[0].layer?.id === 'stop-circles' || e.features[0].layer?.id === 'stop-circles-hitarea')) {
          handleStopLayerClick(e);
        } else if (e.features && e.features.length > 0 && e.features[0].layer?.id === 'route-lines') {
          handleRouteLineClick(e);
        } else {
          handleMapClick();
        }
      }}
      interactiveLayerIds={['vehicle-circles', 'stop-circles', 'stop-circles-hitarea', 'route-lines']}
      cursor="pointer"
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

      {/* Stop markers */}
      <Source id="stops" type="geojson" data={stopsGeoJson}>
        {/* Invisible larger hit area for easier tapping */}
        <Layer
          id="stop-circles-hitarea"
          type="circle"
          paint={{
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              10, 10,
              13, 14,
              15, 18,
              18, 22,
            ],
            'circle-color': 'transparent',
          }}
        />
        <Layer
          id="stop-circles"
          type="circle"
          paint={{
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              10, ['case', ['get', 'isSelected'], 3, 2],
              13, ['case', ['get', 'isSelected'], 5, 3],
              15, ['case', ['get', 'isSelected'], 8, 5],
              18, ['case', ['get', 'isSelected'], 10, 6],
            ],
            'circle-color': ['get', 'color'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': [
              'interpolate', ['linear'], ['zoom'],
              10, ['case', ['get', 'isSelected'], 1, 0.5],
              15, ['case', ['get', 'isSelected'], 2, 1],
            ],
            'circle-opacity': 0.85,
            'circle-stroke-opacity': 0.85,
          }}
        />

      </Source>

      {/* Vehicle markers */}
      {/* WebGL layers for all vehicles (including selected) */}
      <Source id="vehicles" type="geojson" data={vehicleGeoJson}>
        <Layer {...vehiclePingStyle} />
        <Layer {...vehicleArrowStyle} />
        <Layer {...vehicleCircleStyle} />
        <Layer {...vehicleLabelStyle} />
      </Source>

      {/* Popovers rendered after vehicle markers for higher z-index */}
      {/* Vehicle popover - follows selected vehicle */}
      <AnimatePresence>
        {selectedVehicle && (
          <SelectedVehiclePopover
            key={selectedVehicle.vehicleId}
            vehicle={selectedVehicle}
            onClose={() => selectedStop ? onVehicleDeselect?.() : onVehicleSelect?.(null)}
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
              isSubscribed={isSelectedRouteSubscribed}
              patterns={patterns?.get(selectedRouteId!) || undefined}
              vehicles={vehicles}
              onClose={() => onRouteSelect?.(null)}
              onSubscribe={handleRouteSubscribe}
              onUnsubscribe={handleRouteUnsubscribe}
              onBackToStop={onBackToStop}
            />
          </Marker>
        )}
      </AnimatePresence>

      {/* Stop popover - shows above selected stop */}
      <AnimatePresence>
        {selectedStop && !selectedVehicleId && !selectedRouteId && (
          <Marker
            longitude={selectedStop.lon}
            latitude={selectedStop.lat}
            anchor="bottom"
            offset={[0, -10]}
            style={{ zIndex: 10 }}
          >
            <StopPopover
              stop={selectedStop}
              onClose={() => onStopDeselect?.()}
              onRouteActivate={onRouteActivate}
            />
          </Marker>
        )}
      </AnimatePresence>


      <AttributionControl position="bottom-right" compact={true} />
    </Map>
  );
};

export const BusMap = memo(BusMapComponent);
