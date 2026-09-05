import type { Route, RoutePattern, TransportMode, Stop, StopRoute, StopDeparture, VehicleTrip } from '@/types';

const API_ENDPOINT = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1';
export const STATIC_API_CACHE_TTL = 24 * 60 * 60 * 1000;
const STATIC_API_CACHE_NAME = 'busmap-static-api-cache-v1';
const LOCAL_STORAGE_CACHE_SIZE_LIMIT = 2_500_000;

const getApiKey = (): string | undefined => {
  return import.meta.env.VITE_DIGITRANSIT_API_KEY;
};

export interface CachedValue<T> {
  value: T;
  timestamp: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isOptionalString = (value: unknown): value is string | null | undefined => (
  value === undefined || value === null || typeof value === 'string'
);

const getLocalStorageItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const setLocalStorageItem = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors
  }
};

const removeLocalStorageItem = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
};

const removeLocalStorageItemsByPrefix = (prefix: string): void => {
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors
  }
};

const parseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const stringifyJson = (value: unknown): string | null => {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
};

const writeLocalStorageSerialized = (key: string, serialized: string): void => {
  if (serialized.length > LOCAL_STORAGE_CACHE_SIZE_LIMIT) {
    removeLocalStorageItem(key);
    return;
  }

  setLocalStorageItem(key, serialized);
};

const getCacheStorageRequest = (key: string): Request | null => {
  if (typeof window === 'undefined') return null;

  return new Request(`${window.location.origin}/__busmap-api-cache/${encodeURIComponent(key)}`);
};

const readCacheStorageItem = async (key: string): Promise<unknown | null> => {
  if (typeof window === 'undefined' || !window.caches) return null;

  const request = getCacheStorageRequest(key);
  if (!request) return null;

  try {
    const cache = await window.caches.open(STATIC_API_CACHE_NAME);
    const response = await cache.match(request);
    if (!response) return null;

    return await response.json();
  } catch {
    return null;
  }
};

const writeCacheStorageItem = async (key: string, serialized: string): Promise<void> => {
  if (typeof window === 'undefined' || !window.caches) return;

  const request = getCacheStorageRequest(key);
  if (!request) return;

  try {
    const cache = await window.caches.open(STATIC_API_CACHE_NAME);
    await cache.put(request, new Response(serialized, {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch {
    // Ignore storage errors
  }
};

const removeCacheStorageItem = async (key: string): Promise<void> => {
  if (typeof window === 'undefined' || !window.caches) return;

  const request = getCacheStorageRequest(key);
  if (!request) return;

  try {
    const cache = await window.caches.open(STATIC_API_CACHE_NAME);
    await cache.delete(request);
  } catch {
    // Ignore storage errors
  }
};

const deleteCacheStorage = async (cacheName: string): Promise<void> => {
  if (typeof window === 'undefined' || !window.caches) return;

  try {
    await window.caches.delete(cacheName);
  } catch {
    // Ignore storage errors
  }
};

const normalizeTimedCachePayload = <T>(
  payload: unknown,
  field: string,
  normalizeValue: (value: unknown) => T | null
): CachedValue<T> | null => {
  if (!isRecord(payload) || typeof payload.timestamp !== 'number') return null;

  if (Date.now() - payload.timestamp > STATIC_API_CACHE_TTL) return null;

  const value = normalizeValue(payload[field]);
  if (!value) return null;

  return { value, timestamp: payload.timestamp };
};

const readTimedCacheValue = <T>(
  key: string,
  field: string,
  normalizeValue: (value: unknown) => T | null
): CachedValue<T> | null => {
  const cached = getLocalStorageItem(key);
  if (!cached) return null;

  const parsed = parseJson(cached);
  const cacheValue = normalizeTimedCachePayload(parsed, field, normalizeValue);
  if (!cacheValue) {
    removeLocalStorageItem(key);
    return null;
  }

  return cacheValue;
};

const readPersistentTimedCacheValue = async <T>(
  key: string,
  field: string,
  normalizeValue: (value: unknown) => T | null
): Promise<CachedValue<T> | null> => {
  const cachedPayload = await readCacheStorageItem(key);
  const cachedValue = normalizeTimedCachePayload(cachedPayload, field, normalizeValue);
  if (cachedValue) return cachedValue;

  if (cachedPayload !== null) {
    await removeCacheStorageItem(key);
  }

  const localValue = readTimedCacheValue(key, field, normalizeValue);
  if (!localValue) return null;

  const serialized = stringifyJson({ [field]: localValue.value, timestamp: localValue.timestamp });
  if (serialized) {
    await writeCacheStorageItem(key, serialized);
  }

  return localValue;
};

const writePersistentTimedCacheValue = async (key: string, field: string, value: unknown): Promise<void> => {
  const serialized = stringifyJson({ [field]: value, timestamp: Date.now() });
  if (!serialized) return;

  writeLocalStorageSerialized(key, serialized);
  await writeCacheStorageItem(key, serialized);
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
    if (m === 'metro') return 'metro';
    if (m === 'train') return 'train';
    if (m === 'ferry') return 'ferry';
    if (m === 'ubus') return 'ubus';
    if (m === 'robot') return 'robot';
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
  routes: Array<RawRoute | null>;
}

interface RawRoute {
  gtfsId?: string | null;
  shortName?: string | null;
  longName?: string | null;
  mode?: string | null;
  color?: string | null;
}

interface RawStopRoute {
  gtfsId?: string | null;
  shortName?: string | null;
  longName?: string | null;
  mode?: string | null;
}

interface RawStop {
  gtfsId?: string | null;
  name?: string | null;
  code?: string | null;
  lat?: number | null;
  lon?: number | null;
  vehicleMode?: string | null;
  routes?: RawStopRoute[] | null;
  patterns?: Array<{
    headsign?: string | null;
    directionId?: number | null;
    route?: {
      gtfsId?: string | null;
    } | null;
  } | null> | null;
}

type SearchableRawRoute = RawRoute & {
  gtfsId: string;
  shortName: string;
  longName: string;
};

const isSearchableRoute = (route: unknown): route is SearchableRawRoute => {
  if (!isRecord(route)) return false;

  return typeof route.gtfsId === 'string' && route.gtfsId.length > 0
    && typeof route.shortName === 'string' && route.shortName.length > 0
    && typeof route.longName === 'string'
    && isOptionalString(route.mode)
    && isOptionalString(route.color);
};

const normalizeRoute = (route: SearchableRawRoute): Route => ({
  gtfsId: route.gtfsId,
  shortName: route.shortName,
  longName: route.longName,
  mode: normalizeMode(route.mode ?? undefined, route.gtfsId),
  color: route.color ?? undefined,
});

const isSearchableStop = (stop: unknown): stop is RawStop & {
  gtfsId: string;
  name: string;
  lat: number;
  lon: number;
} => {
  if (!isRecord(stop)) return false;

  return typeof stop.gtfsId === 'string' && stop.gtfsId.length > 0
    && typeof stop.name === 'string' && stop.name.length > 0
    && typeof stop.lat === 'number'
    && typeof stop.lon === 'number'
    && isOptionalString(stop.code)
    && isOptionalString(stop.vehicleMode)
    && (stop.routes === undefined || stop.routes === null || Array.isArray(stop.routes))
    && (stop.patterns === undefined || stop.patterns === null || Array.isArray(stop.patterns));
};

const isSearchableStopRoute = (route: unknown): route is RawStopRoute & {
  gtfsId: string;
  shortName: string;
  longName: string;
} => {
  if (!isRecord(route)) return false;

  return typeof route.gtfsId === 'string' && route.gtfsId.length > 0
    && typeof route.shortName === 'string' && route.shortName.length > 0
    && typeof route.longName === 'string'
    && isOptionalString(route.mode);
};

const sortRoutesByShortName = (routes: Route[]): Route[] => routes.sort((firstRoute, secondRoute) => {
  const firstNumber = parseInt(firstRoute.shortName, 10);
  const secondNumber = parseInt(secondRoute.shortName, 10);

  if (!isNaN(firstNumber) && !isNaN(secondNumber)) {
    return firstNumber - secondNumber;
  }
  return firstRoute.shortName.localeCompare(secondRoute.shortName);
});

const normalizeRouteList = (rawRoutes: unknown[]): Route[] => {
  const seen = new Set<string>();
  const routes: Route[] = [];

  for (const route of rawRoutes) {
    if (!isSearchableRoute(route)) continue;
    if (seen.has(route.shortName)) continue;

    seen.add(route.shortName);
    routes.push(normalizeRoute(route));
  }

  return sortRoutesByShortName(routes);
};

const getStopPatternMetadata = (stop: RawStop) => {
  const headsigns = new Set<string>();
  const routeDirections: Record<string, number[]> = {};

  const patterns = Array.isArray(stop.patterns) ? stop.patterns : [];
  for (const pattern of patterns) {
    if (!isRecord(pattern)) continue;

    if (typeof pattern.headsign === 'string') {
      headsigns.add(pattern.headsign);
    }

    const routeId = isRecord(pattern.route) && typeof pattern.route.gtfsId === 'string'
      ? pattern.route.gtfsId
      : null;
    if (!routeId || typeof pattern.directionId !== 'number') continue;

    if (!(routeId in routeDirections)) {
      routeDirections[routeId] = [];
    }
    if (!routeDirections[routeId].includes(pattern.directionId)) {
      routeDirections[routeId].push(pattern.directionId);
    }
  }

  return {
    headsigns: Array.from(headsigns),
    routeDirections,
  };
};

const normalizeStop = (stop: RawStop & {
  gtfsId: string;
  name: string;
  lat: number;
  lon: number;
}): Stop => {
  const { headsigns, routeDirections } = getStopPatternMetadata(stop);

  return {
    gtfsId: stop.gtfsId,
    name: stop.name,
    code: stop.code ?? '',
    lat: stop.lat,
    lon: stop.lon,
    vehicleMode: normalizeMode(stop.vehicleMode ?? undefined),
    routes: (Array.isArray(stop.routes) ? stop.routes : [])
      .filter(isSearchableStopRoute)
      .map((route) => ({
        gtfsId: route.gtfsId,
        shortName: route.shortName,
        longName: route.longName,
        mode: normalizeMode(route.mode ?? undefined, route.gtfsId),
      })),
    headsigns,
    routeDirections,
  };
};

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
  return normalizeRouteList(data.routes);
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

  const cachedRoutes = await getCachedRoutes();
  const cachedRoutesById = new Map(cachedRoutes?.map((route) => [route.gtfsId, route]) ?? []);
  const missingRouteIds = routeIds.filter((routeId) => !cachedRoutesById.has(routeId));

  if (missingRouteIds.length === 0) {
    return routeIds
      .map((routeId) => cachedRoutesById.get(routeId))
      .filter((route): route is Route => route !== undefined);
  }

  const idsString = missingRouteIds.map((routeId) => `"${routeId}"`).join(', ');

  const query = `{
    routes(ids: [${idsString}]) {
      gtfsId
      shortName
      longName
      mode
    }
  }`;

  const data = await graphqlFetch<RoutesResponse>(query);

  const fetchedRoutesById = new Map(data.routes
    .filter(isSearchableRoute)
    .map(normalizeRoute)
    .map((route) => [route.gtfsId, route]));

  return routeIds
    .map((routeId) => cachedRoutesById.get(routeId) ?? fetchedRoutesById.get(routeId))
    .filter((route): route is Route => route !== undefined);
};

export const fetchRoutePatterns = async (routeIds: string[]): Promise<Map<string, RoutePattern[]>> => {
  if (routeIds.length === 0) {
    return new Map();
  }

  const cachedPatterns = await getCachedRoutePatterns(routeIds);
  const missingRouteIds = routeIds.filter((routeId) => !cachedPatterns.has(routeId));

  if (missingRouteIds.length === 0) {
    return cachedPatterns;
  }

  const idsString = missingRouteIds.map((routeId) => `"${routeId}"`).join(', ');

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

  for (const routeId of missingRouteIds) {
    if (!result.has(routeId)) {
      result.set(routeId, []);
    }
  }

  await setCachedRoutePatterns(result);

  for (const [routeId, patterns] of result) {
    cachedPatterns.set(routeId, patterns);
  }

  return cachedPatterns;
};

// Check if the API key is configured
export const isApiKeyConfigured = (): boolean => {
  const key = getApiKey();
  return !!key && key !== 'your_api_key_here';
};

// Cache routes in localStorage
const ROUTES_CACHE_KEY = 'busmap-routes-cache';

const normalizeCachedRoutes = (value: unknown): Route[] | null => {
  if (!Array.isArray(value)) return null;

  const routes = normalizeRouteList(value);
  return routes.length > 0 ? routes : null;
};

export const getCachedRoutesSnapshot = (): CachedValue<Route[]> | null => (
  readTimedCacheValue(ROUTES_CACHE_KEY, 'routes', normalizeCachedRoutes)
);

export const getCachedRoutes = async (): Promise<Route[] | null> => (
  (await readPersistentTimedCacheValue(ROUTES_CACHE_KEY, 'routes', normalizeCachedRoutes))?.value ?? null
);

export const setCachedRoutes = async (routes: Route[]): Promise<void> => {
  await writePersistentTimedCacheValue(ROUTES_CACHE_KEY, 'routes', routes);
};

// Cache stops in localStorage
const STOPS_CACHE_KEY = 'busmap-stops-cache';

const isTransportMode = (value: unknown): value is TransportMode => (
  value === 'bus'
  || value === 'tram'
  || value === 'train'
  || value === 'ferry'
  || value === 'metro'
  || value === 'ubus'
  || value === 'robot'
);

const isCachedStopRoute = (route: unknown): route is StopRoute => {
  if (!isRecord(route)) return false;

  return typeof route.gtfsId === 'string' && route.gtfsId.length > 0
    && typeof route.shortName === 'string' && route.shortName.length > 0
    && typeof route.longName === 'string'
    && isTransportMode(route.mode);
};

const isCachedStop = (stop: unknown): stop is Stop => {
  if (!isRecord(stop)) return false;

  return typeof stop.gtfsId === 'string' && stop.gtfsId.length > 0
    && typeof stop.name === 'string' && stop.name.length > 0
    && typeof stop.code === 'string'
    && typeof stop.lat === 'number'
    && typeof stop.lon === 'number'
    && isTransportMode(stop.vehicleMode)
    && Array.isArray(stop.routes)
    && stop.routes.every(isCachedStopRoute);
};

const normalizeCachedStops = (value: unknown): Stop[] | null => {
  if (!Array.isArray(value)) return null;

  const stops = value.filter(isCachedStop);
  return stops.length > 0 ? stops : null;
};

export const getCachedStopsSnapshot = (): CachedValue<Stop[]> | null => (
  readTimedCacheValue(STOPS_CACHE_KEY, 'stops', normalizeCachedStops)
);

export const getCachedStops = async (): Promise<Stop[] | null> => (
  (await readPersistentTimedCacheValue(STOPS_CACHE_KEY, 'stops', normalizeCachedStops))?.value ?? null
);

export const setCachedStops = async (stops: Stop[]): Promise<void> => {
  await writePersistentTimedCacheValue(STOPS_CACHE_KEY, 'stops', stops);
};

// Cache route pattern geometry in browser storage
const ROUTE_PATTERNS_CACHE_KEY = 'busmap-route-patterns-cache';

const isCoordinate = (value: unknown): value is { lat: number; lon: number } => {
  if (!isRecord(value)) return false;

  return typeof value.lat === 'number' && typeof value.lon === 'number';
};

const isRoutePattern = (value: unknown): value is RoutePattern => {
  if (!isRecord(value)) return false;

  return typeof value.gtfsId === 'string' && value.gtfsId.length > 0
    && typeof value.name === 'string'
    && Array.isArray(value.geometry)
    && value.geometry.every(isCoordinate);
};

const normalizeCachedRoutePatterns = (value: unknown): RoutePattern[] | null => {
  if (!Array.isArray(value)) return null;
  if (!value.every(isRoutePattern)) return null;

  return value;
};

const getRoutePatternsCacheKey = (routeId: string): string => `${ROUTE_PATTERNS_CACHE_KEY}:${routeId}`;

export const clearStaticApiCache = async (): Promise<void> => {
  removeLocalStorageItem(ROUTES_CACHE_KEY);
  removeLocalStorageItem(STOPS_CACHE_KEY);
  removeLocalStorageItem(ROUTE_PATTERNS_CACHE_KEY);
  removeLocalStorageItemsByPrefix(`${ROUTE_PATTERNS_CACHE_KEY}:`);
  await deleteCacheStorage(STATIC_API_CACHE_NAME);
};

const getCachedRoutePatterns = async (routeIds: string[]): Promise<Map<string, RoutePattern[]>> => {
  const patternsByRouteId = new Map<string, RoutePattern[]>();

  await Promise.all(routeIds.map(async (routeId) => {
    const cached = await readPersistentTimedCacheValue(
      getRoutePatternsCacheKey(routeId),
      'patterns',
      normalizeCachedRoutePatterns
    );
    if (!cached) return;

    patternsByRouteId.set(routeId, cached.value);
  }));

  return patternsByRouteId;
};

const setCachedRoutePatterns = async (patternsByRouteId: Map<string, RoutePattern[]>): Promise<void> => {
  if (patternsByRouteId.size === 0) return;

  await Promise.all(Array.from(patternsByRouteId, ([routeId, patterns]) => (
    writePersistentTimedCacheValue(getRoutePatternsCacheKey(routeId), 'patterns', patterns)
  )));
};

interface StopsResponse {
  stops: Array<RawStop | null>;
}

export const fetchAllStops = async (): Promise<Stop[]> => {
  const query = `{
    stops {
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
        directionId
        route {
          gtfsId
        }
      }
    }
  }`;

  const data = await graphqlFetch<StopsResponse>(query);

  return data.stops
    .filter(isSearchableStop)
    .map(normalizeStop)
    .sort((a, b) => {
      const codeCompare = a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
      if (codeCompare !== 0) return codeCompare;
      return a.name.localeCompare(b.name);
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

interface VehicleTripResponse {
  fuzzyTrip: {
    gtfsId: string;
    directionId: string;
    tripHeadsign: string | null;
    stoptimes: Array<{
      stop: {
        gtfsId: string;
        name: string;
        code: string;
        lat: number;
        lon: number;
      } | null;
      serviceDay: number;
      stopPositionInPattern: number;
      scheduledArrival: number | null;
      scheduledDeparture: number | null;
      realtimeArrival: number | null;
      realtimeDeparture: number | null;
      departureDelay: number | null;
      realtime: boolean | null;
      realtimeState: string | null;
    } | null>;
  } | null;
}

const escapeGraphqlString = (value: string): string => (
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
);

const parseTripStartTime = (value: string): number | null => {
  const match = /^(\d+):(\d{2})$/.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) return null;
  return hours * 60 * 60 + minutes * 60;
};

// GTFS service time starts twelve hours before local noon, including on DST
// transition days. Trip.stoptimes may return serviceDay=-1 (schedule only).
const getHelsinkiServiceDay = (operatingDay: string): number => {
  const noonUtc = new Date(`${operatingDay}T12:00:00Z`);
  const localHour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki', hour: '2-digit', hourCycle: 'h23',
  }).format(noonUtc));
  return noonUtc.getTime() / 1000 - localHour * 3600;
};

// Match an HFP vehicle to its scheduled trip so the vehicle detail view can
// show the ordered stops, including the current and upcoming stops.
export const fetchVehicleTrip = async (
  routeId: string,
  direction: 1 | 2,
  operatingDay: string,
  startTime: string,
): Promise<VehicleTrip | null> => {
  const startSeconds = parseTripStartTime(startTime);
  if (startSeconds === null || !/^\d{4}-\d{2}-\d{2}$/.test(operatingDay)
    || !Number.isFinite(Date.parse(`${operatingDay}T12:00:00Z`))) return null;

  const query = `{
    fuzzyTrip(
      route: "${escapeGraphqlString(routeId)}"
      direction: ${direction - 1}
      date: "${escapeGraphqlString(operatingDay)}"
      time: ${startSeconds}
    ) {
      gtfsId
      directionId
      tripHeadsign
      stoptimes {
        serviceDay
        stop {
          gtfsId
          name
          code
          lat
          lon
        }
        stopPositionInPattern
        scheduledArrival
        scheduledDeparture
        realtimeArrival
        realtimeDeparture
        departureDelay
        realtime
        realtimeState
      }
    }
  }`;

  const data = await graphqlFetch<VehicleTripResponse>(query);
  const trip = data.fuzzyTrip;
  if (!trip) return null;

  return {
    gtfsId: trip.gtfsId,
    directionId: Number(trip.directionId),
    headsign: trip.tripHeadsign ?? '',
    stops: trip.stoptimes.flatMap((st) => {
      if (!st?.stop) return [];

      return [{
        gtfsId: st.stop.gtfsId,
        name: st.stop.name,
        code: st.stop.code,
        lat: st.stop.lat,
        lon: st.stop.lon,
        serviceDay: st.serviceDay > 0 ? st.serviceDay : getHelsinkiServiceDay(operatingDay),
        stopPosition: st.stopPositionInPattern,
        scheduledArrival: st.scheduledArrival,
        scheduledDeparture: st.scheduledDeparture,
        realtimeArrival: st.realtimeArrival,
        realtimeDeparture: st.realtimeDeparture,
        departureDelay: st.departureDelay ?? 0,
        realtime: st.realtime ?? false,
        realtimeState: st.realtimeState ?? 'SCHEDULED',
      }];
    }),
  };
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
