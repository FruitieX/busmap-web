import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  fetchAllRoutes,
  fetchAllStops,
  fetchRoutePatterns,
  fetchStopTimetable,
  fetchVehicleTrip,
  getCachedRoutes,
  getCachedRoutesSnapshot,
  getCachedStops,
  getCachedStopsSnapshot,
  setCachedRoutes,
  setCachedStops,
  isApiKeyConfigured,
  STATIC_API_CACHE_TTL,
} from './api';
import type { StopTimetableResult } from './api';
import type { Route, RoutePattern, Stop, TrackedVehicle, VehicleTrip } from '@/types';

const ROUTES_QUERY_KEY = ['routes', 'normalized'] as const;
const STOPS_QUERY_KEY = ['stops', 'normalized'] as const;

export const useRoutes = () => {
  const cachedRoutes = getCachedRoutesSnapshot();

  return useQuery<Route[], Error>({
    queryKey: ROUTES_QUERY_KEY,
    queryFn: async () => {
      const cached = await getCachedRoutes();
      if (cached) return cached;

      const routes = await fetchAllRoutes();
      await setCachedRoutes(routes);
      return routes;
    },
    initialData: cachedRoutes?.value,
    initialDataUpdatedAt: cachedRoutes?.timestamp,
    staleTime: STATIC_API_CACHE_TTL,
    gcTime: STATIC_API_CACHE_TTL,
    enabled: isApiKeyConfigured(),
    retry: 2,
  });
};

export const useStops = (enabled = true) => {
  const cachedStops = getCachedStopsSnapshot();

  return useQuery<Stop[], Error>({
    queryKey: STOPS_QUERY_KEY,
    queryFn: async () => {
      const cached = await getCachedStops();
      if (cached) return cached;

      const stops = await fetchAllStops();
      await setCachedStops(stops);
      return stops;
    },
    initialData: cachedStops?.value,
    initialDataUpdatedAt: cachedStops?.timestamp,
    staleTime: STATIC_API_CACHE_TTL,
    gcTime: STATIC_API_CACHE_TTL,
    enabled: enabled && isApiKeyConfigured(),
    retry: 2,
  });
};

export const useRoutePatterns = (routeIds: string[]) => {
  return useQuery<Map<string, RoutePattern[]>, Error>({
    queryKey: ['routePatterns', routeIds],
    queryFn: () => fetchRoutePatterns(routeIds),
    staleTime: STATIC_API_CACHE_TTL,
    gcTime: STATIC_API_CACHE_TTL,
    enabled: routeIds.length > 0 && isApiKeyConfigured(),
    placeholderData: keepPreviousData, // keep showing old patterns while refetching
  });
};

export const useStopTimetable = (stopId: string | null) => {
  return useQuery<StopTimetableResult, Error>({
    queryKey: ['stopTimetable', stopId],
    queryFn: () => fetchStopTimetable(stopId!),
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
    enabled: stopId !== null && isApiKeyConfigured(),
    refetchInterval: 1000 * 30, // Auto-refresh every 30 seconds
    refetchOnWindowFocus: true,
  });
};

export const useVehicleTrip = (vehicle: TrackedVehicle | null) => {
  const routeId = vehicle ? `HSL:${vehicle.routeId}` : null;

  return useQuery<VehicleTrip | null, Error>({
    queryKey: ['vehicleTrip', routeId, vehicle?.direction, vehicle?.operatingDay, vehicle?.startTime],
    queryFn: () => fetchVehicleTrip(
      routeId!,
      vehicle!.direction,
      vehicle!.operatingDay,
      vehicle!.startTime,
    ),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
    enabled: vehicle !== null && routeId !== null && isApiKeyConfigured(),
    refetchInterval: 1000 * 30,
    refetchOnWindowFocus: true,
  });
};
