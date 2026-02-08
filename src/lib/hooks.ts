import { useQuery } from '@tanstack/react-query';
import { fetchAllRoutes, fetchRoutePatterns, fetchNearbyStops, fetchStopTimetable, getCachedRoutes, setCachedRoutes, isApiKeyConfigured } from './api';
import type { StopTimetableResult } from './api';
import type { Route, RoutePattern, Stop } from '@/types';

export const useRoutes = () => {
  return useQuery<Route[], Error>({
    queryKey: ['routes'],
    queryFn: async () => {
      // Try cache first
      const cached = getCachedRoutes();
      if (cached) {
        // Still fetch in background to update cache
        fetchAllRoutes().then(setCachedRoutes).catch(() => {});
        return cached;
      }

      const routes = await fetchAllRoutes();
      setCachedRoutes(routes);
      return routes;
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
    enabled: isApiKeyConfigured(),
    retry: 2,
  });
};

export const useRoutePatterns = (routeIds: string[]) => {
  return useQuery<Map<string, RoutePattern[]>, Error>({
    queryKey: ['routePatterns', routeIds],
    queryFn: () => fetchRoutePatterns(routeIds),
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
    enabled: routeIds.length > 0 && isApiKeyConfigured(),
  });
};

export const useNearbyStops = (lat: number | null, lon: number | null, radius: number) => {
  return useQuery<Array<Stop & { distance: number }>, Error>({
    queryKey: ['nearbyStops', lat, lon, radius],
    queryFn: () => fetchNearbyStops(lat!, lon!, radius),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
    enabled: lat !== null && lon !== null && radius > 0 && isApiKeyConfigured(),
    refetchOnWindowFocus: false,
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
