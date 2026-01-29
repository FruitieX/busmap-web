import { useQuery } from '@tanstack/react-query';
import { fetchAllRoutes, fetchRoutePatterns, getCachedRoutes, setCachedRoutes, isApiKeyConfigured } from './api';
import type { Route, RoutePattern } from '@/types';

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
