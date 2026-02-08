import type { Route, RoutePattern, TransportMode, Stop, StopRoute, StopDeparture } from '@/types';

const API_ENDPOINT = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1';

const getApiKey = (): string | undefined => {
  return import.meta.env.VITE_DIGITRANSIT_API_KEY;
};

const graphqlFetch = async <T>(query: string): Promise<T> => {
  const apiKey = getApiKey();

  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('Digitransit API key not configured. See .env.example for setup instructions.');
  }

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/graphql',
      'digitransit-subscription-key': apiKey,
    },
    body: query,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid API key. Please check your Digitransit subscription key.');
    }
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0]?.message || 'GraphQL error');
  }

  return data.data;
};

// Infer transport mode from route ID or normalize mode string
export const normalizeMode = (mode?: string, gtfsId?: string): TransportMode => {
  if (mode) {
    const m = mode.toLowerCase();
    if (m === 'subway') return 'metro';
    if (m === 'rail') return 'train';
    if (m === 'bus') return 'bus';
    if (m === 'tram') return 'tram';
    if (m === 'ferry') return 'ferry';
  }

  if (!gtfsId) return 'bus';

  const id = gtfsId.replace('HSL:', '');

  // Common patterns:
  // 1xxx, 2xxx, 4xxx-9xxx = bus (most routes)
  // 10xx = tram
  // 31xx = metro
  // 30xx = train
  // 19xx = ferry (Suomenlinna)

  if (/^10\d{2}/.test(id)) return 'tram';
  if (/^31\d{2}/.test(id)) return 'metro';
  if (/^300\d/.test(id) || /^900\d/.test(id)) return 'train';
  if (/^19\d{2}/.test(id)) return 'ferry';

  return 'bus';
};

interface RoutesResponse {
  routes: Array<{
    gtfsId: string;
    shortName: string;
    longName: string;
    mode?: string;
  }>;
}

export const fetchAllRoutes = async (): Promise<Route[]> => {
  const query = `{
    routes {
      gtfsId
      shortName
      longName
      mode
    }
  }`;

  const data = await graphqlFetch<RoutesResponse>(query);

  // Deduplicate routes by shortName (API sometimes returns duplicates)
  const seen = new Set<string>();
  const routes: Route[] = [];

  for (const route of data.routes) {
    if (!seen.has(route.shortName)) {
      seen.add(route.shortName);
      routes.push({
        gtfsId: route.gtfsId,
        shortName: route.shortName,
        longName: route.longName,
        mode: normalizeMode(route.mode, route.gtfsId),
      });
    }
  }

  // Sort by route number (numeric sort)
  routes.sort((a, b) => {
    const aNum = parseInt(a.shortName, 10);
    const bNum = parseInt(b.shortName, 10);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum - bNum;
    }
    return a.shortName.localeCompare(b.shortName);
  });

  return routes;
};

interface RoutePatternResponse {
  routes: Array<{
    gtfsId: string;
    shortName: string;
    patterns: Array<{
      name: string;
      geometry: Array<{ lat: number; lon: number }>;
    }>;
  }>;
}

export const fetchRoutesByIds = async (routeIds: string[]): Promise<Route[]> => {
  if (routeIds.length === 0) return [];

  const idsString = routeIds.map((id) => `"${id}"`).join(', ');

  const query = `{
    routes(ids: [${idsString}]) {
      gtfsId
      shortName
      longName
      mode
    }
  }`;

  const data = await graphqlFetch<RoutesResponse>(query);

  return data.routes
    .filter((route) => route != null)
    .map((route) => ({
      gtfsId: route.gtfsId,
      shortName: route.shortName,
      longName: route.longName,
      mode: normalizeMode(route.mode, route.gtfsId),
    }));
};

export const fetchRoutePatterns = async (routeIds: string[]): Promise<Map<string, RoutePattern[]>> => {
  if (routeIds.length === 0) {
    return new Map();
  }

  const idsString = routeIds.map((id) => `"${id}"`).join(', ');

  const query = `{
    routes(ids: [${idsString}]) {
      gtfsId
      shortName
      patterns {
        name
        geometry {
          lat
          lon
        }
      }
    }
  }`;

  const data = await graphqlFetch<RoutePatternResponse>(query);

  const result = new Map<string, RoutePattern[]>();

  for (const route of data.routes) {
    const patterns: RoutePattern[] = route.patterns.map((p) => ({
      gtfsId: route.gtfsId,
      name: p.name,
      geometry: p.geometry,
    }));
    result.set(route.gtfsId, patterns);
  }

  return result;
};

// Check if the API key is configured
export const isApiKeyConfigured = (): boolean => {
  const key = getApiKey();
  return !!key && key !== 'your_api_key_here';
};

// Cache routes in localStorage
const ROUTES_CACHE_KEY = 'busmap-routes-cache';
const ROUTES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface RoutesCache {
  routes: Route[];
  timestamp: number;
}

export const getCachedRoutes = (): Route[] | null => {
  try {
    const cached = localStorage.getItem(ROUTES_CACHE_KEY);
    if (!cached) return null;

    const data: RoutesCache = JSON.parse(cached);
    if (Date.now() - data.timestamp > ROUTES_CACHE_TTL) {
      localStorage.removeItem(ROUTES_CACHE_KEY);
      return null;
    }

    return data.routes;
  } catch {
    return null;
  }
};

export const setCachedRoutes = (routes: Route[]): void => {
  try {
    const data: RoutesCache = {
      routes,
      timestamp: Date.now(),
    };
    localStorage.setItem(ROUTES_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
};

// Fetch nearby stops by location and radius
interface StopsByRadiusResponse {
  stopsByRadius: {
    edges: Array<{
      node: {
        stop: {
          gtfsId: string;
          name: string;
          code: string;
          lat: number;
          lon: number;
          vehicleMode: string;
          routes: Array<{
            gtfsId: string;
            shortName: string;
            longName: string;
            mode: string;
          }>;
          patterns: Array<{
            headsign: string;
          }>;
        };
        distance: number;
      };
    }>;
  };
}

export const fetchNearbyStops = async (
  lat: number,
  lon: number,
  radius: number,
): Promise<Array<Stop & { distance: number }>> => {
  const query = `{
    stopsByRadius(lat: ${lat}, lon: ${lon}, radius: ${radius}, first: 300) {
      edges {
        node {
          stop {
            gtfsId
            name
            code
            lat
            lon
            vehicleMode
            routes {
              gtfsId
              shortName
              longName
              mode
            }
            patterns {
              headsign
            }
          }
          distance
        }
      }
    }
  }`;

  const data = await graphqlFetch<StopsByRadiusResponse>(query);

  return data.stopsByRadius.edges.map(({ node }) => {
    // Extract unique headsigns from patterns (direction-specific)
    const headsigns = [...new Set(
      node.stop.patterns
        .map((p) => p.headsign)
        .filter((h): h is string => !!h),
    )];

    return {
      gtfsId: node.stop.gtfsId,
      name: node.stop.name,
      code: node.stop.code || '',
      lat: node.stop.lat,
      lon: node.stop.lon,
      vehicleMode: normalizeMode(node.stop.vehicleMode),
      routes: node.stop.routes.map((r) => ({
        gtfsId: r.gtfsId,
        shortName: r.shortName,
        longName: r.longName,
        mode: normalizeMode(r.mode, r.gtfsId),
      })),
      headsigns,
      distance: node.distance,
    };
  });
};

// Fetch stop timetable with upcoming departures and direction info
export interface StopTimetableResult {
  departures: StopDeparture[];
  directions: Record<string, number[]>; // routeGtfsId -> allowed MQTT direction values (1 or 2)
}

interface StopTimetableResponse {
  stop: {
    stoptimesWithoutPatterns: Array<{
      scheduledDeparture: number;
      realtimeDeparture: number;
      departureDelay: number;
      realtime: boolean;
      realtimeState: string;
      headsign: string;
      serviceDay: number;
      trip: {
        directionId: string;
        departureStoptime: {
          scheduledDeparture: number; // seconds from midnight at first stop
        };
        route: {
          gtfsId: string;
          shortName: string;
          longName: string;
          mode: string;
        };
      };
    }>;
  };
}

export const fetchStopTimetable = async (stopId: string): Promise<StopTimetableResult> => {
  const query = `{
    stop(id: "${stopId}") {
      stoptimesWithoutPatterns(numberOfDepartures: 20) {
        scheduledDeparture
        realtimeDeparture
        departureDelay
        realtime
        realtimeState
        headsign
        serviceDay
        trip {
          directionId
          departureStoptime {
            scheduledDeparture
          }
          route {
            gtfsId
            shortName
            longName
            mode
          }
        }
      }
    }
  }`;

  const data = await graphqlFetch<StopTimetableResponse>(query);

  const directionMap: Record<string, Set<number>> = {};
  const departures: StopDeparture[] = data.stop.stoptimesWithoutPatterns.map((st) => {
    const gtfsDir = parseInt(st.trip.directionId, 10);
    const mqttDir = gtfsDir + 1; // GTFS 0 -> MQTT 1, GTFS 1 -> MQTT 2

    if (!directionMap[st.trip.route.gtfsId]) {
      directionMap[st.trip.route.gtfsId] = new Set();
    }
    directionMap[st.trip.route.gtfsId].add(mqttDir);

    return {
      scheduledDeparture: st.scheduledDeparture,
      realtimeDeparture: st.realtimeDeparture,
      departureDelay: st.departureDelay,
      realtime: st.realtime,
      realtimeState: st.realtimeState,
      headsign: st.headsign,
      serviceDay: st.serviceDay,
      routeGtfsId: st.trip.route.gtfsId,
      routeShortName: st.trip.route.shortName,
      routeLongName: st.trip.route.longName,
      routeMode: normalizeMode(st.trip.route.mode, st.trip.route.gtfsId),
      directionId: gtfsDir,
      tripStartTime: (() => {
        const secs = st.trip.departureStoptime.scheduledDeparture;
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      })(),
    };
  });

  const directions: Record<string, number[]> = {};
  for (const [routeId, dirs] of Object.entries(directionMap)) {
    directions[routeId] = Array.from(dirs);
  }

  return { departures, directions };
};

// Fetch routes for a specific stop
interface StopRoutesResponse {
  stop: {
    gtfsId: string;
    name: string;
    code: string;
    lat: number;
    lon: number;
    vehicleMode: string;
    routes: Array<{
      gtfsId: string;
      shortName: string;
      longName: string;
      mode: string;
    }>;
  };
}

export const fetchStopRoutes = async (stopId: string): Promise<StopRoute[]> => {
  const query = `{
    stop(id: "${stopId}") {
      routes {
        gtfsId
        shortName
        longName
        mode
      }
    }
  }`;

  const data = await graphqlFetch<StopRoutesResponse>(query);

  return data.stop.routes.map((r) => ({
    gtfsId: r.gtfsId,
    shortName: r.shortName,
    longName: r.longName,
    mode: normalizeMode(r.mode, r.gtfsId),
  }));
};
