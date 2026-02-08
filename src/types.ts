// Transport modes supported by HSL
export type TransportMode = 'bus' | 'tram' | 'train' | 'ferry' | 'metro' | 'ubus' | 'robot';

// Color mapping for transport modes
export const TRANSPORT_COLORS: Record<TransportMode, string> = {
  bus: '#007ac9',
  tram: '#00985f',
  train: '#8c4799',
  ferry: '#00b9e4',
  metro: '#ff6319',
  ubus: '#999999',
  robot: '#999999',
};

// Route from Digitransit API
export interface Route {
  gtfsId: string;
  shortName: string;
  longName: string;
  mode?: TransportMode;
  color?: string;
}

// Pattern/variant of a route
export interface RoutePattern {
  gtfsId: string;
  name: string;
  geometry: Array<{ lat: number; lon: number }>;
}

// Subscribed route with metadata
export interface SubscribedRoute {
  gtfsId: string;
  shortName: string;
  longName: string;
  mode: TransportMode;
  color: string;
  subscribedAt: number;
}

// Vehicle position from MQTT HFP message
export interface VehiclePosition {
  // Vehicle identification
  vehicleId: string; // operator_id/vehicle_number
  operatorId: number;
  vehicleNumber: number;

  // Position
  lat: number;
  lng: number;
  heading: number;
  speed: number; // m/s
  acceleration: number; // m/s²

  // Trip info
  routeId: string; // e.g., "2551"
  routeShortName: string; // e.g., "551"
  direction: 1 | 2;
  headsign: string;
  startTime: string; // HH:mm
  operatingDay: string; // YYYY-MM-DD

  // Status
  delay: number; // seconds, negative = early
  nextStopId: string | null;
  doorStatus: 0 | 1;
  occupancy: number; // 0-100

  // Timestamps
  timestamp: Date;
  receivedAt: Date;

  // Transport mode
  mode: TransportMode;
}

// Tracked vehicle with animation state
export interface TrackedVehicle extends VehiclePosition {
  // Derived motion rates (computed from consecutive samples)
  reportedHeading?: number; // raw heading from GPS/compass
  speedAcceleration?: number; // m/s² (observed speed change rate)

  // Is this from a subscribed route or nearby discovery?
  isSubscribed: boolean;

  // Stale timeout
  lastUpdate: number; // last MQTT message received
  lastPositionUpdate: number; // last time position actually changed

  // Exit animation timestamp (set when vehicle should fade out)
  exitingAt?: number;
}

// Bounding box for nearby mode
export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

// Available map tile styles from CARTO
export type MapStyle = 'voyager' | 'positron' | 'dark-matter';

export const MAP_STYLES: Record<MapStyle, { label: string; url: string }> = {
  voyager: {
    label: 'Voyager',
    url: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  },
  positron: {
    label: 'Positron (Light)',
    url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  'dark-matter': {
    label: 'Dark Matter',
    url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
};

// Stop route info (route that serves a stop)
export interface StopRoute {
  gtfsId: string;
  shortName: string;
  longName: string;
  mode: TransportMode;
}

// Transit stop
export interface Stop {
  gtfsId: string;
  name: string;
  code: string;
  lat: number;
  lon: number;
  vehicleMode: TransportMode;
  routes: StopRoute[];
}

// Upcoming departure at a stop (from Digitransit stoptimes API)
export interface StopDeparture {
  scheduledDeparture: number; // seconds from midnight of serviceDay
  realtimeDeparture: number;
  departureDelay: number; // seconds (positive = late)
  realtime: boolean;
  realtimeState: string; // SCHEDULED | UPDATED | CANCELED etc.
  headsign: string;
  serviceDay: number; // epoch seconds for midnight of service day
  routeGtfsId: string;
  routeShortName: string;
  routeLongName: string;
  routeMode: TransportMode;
  directionId: number; // GTFS direction (0 or 1)
}

// App settings
export interface Settings {
  showNearby: boolean;
  nearbyRadius: number; // meters
  locationRadius: number; // meters, converted to zoom level for map
  theme: 'light' | 'dark' | 'system';
  mapStyle: MapStyle;
  showRouteLines: boolean;
  showStops: boolean;
  showNearbyRoutes: boolean;
  animateVehicles: boolean;
  developerMode: boolean;
}

// Map viewport state
export interface MapViewport {
  latitude: number;
  longitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

// User location
export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

// Connection status
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// MQTT subscription
export interface MqttSubscription {
  topic: string;
  routeId?: string;
  geohash?: string;
}
