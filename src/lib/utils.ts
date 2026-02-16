import { EARTH_RADIUS_M } from '@/constants';
import { TRANSPORT_COLORS } from '@/types';
import type { RouteColorMode, TransportMode } from '@/types';

/** Haversine distance between two lat/lng points in meters */
export const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Extract unique terminus/destination names, preferring direction-specific headsigns over route longNames */
export const getStopTermini = (routes: Array<{ longName: string }>, headsigns?: string[]): string | null => {
  // Use direction-specific headsigns when available
  if (headsigns && headsigns.length > 0) {
    return headsigns.join(', ');
  }

  // Fallback: extract from route longNames (HSL format "Origin - Destination")
  const termini = new Set<string>();
  for (const r of routes) {
    const parts = r.longName.split(' - ');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) termini.add(trimmed);
    }
  }
  if (termini.size === 0) return null;
  return Array.from(termini).join(', ');
};

const UNIQUE_ROUTE_COLORS = [
  '#D7263D', '#F46036', '#2E294E', '#1B998B', '#E71D36', '#FF9F1C', '#3A86FF', '#8338EC',
  '#FB5607', '#FF006E', '#5E60CE', '#00A896', '#2A9D8F', '#8AC926', '#1982C4', '#6A4C93',
  '#EF476F', '#06D6A0', '#118AB2', '#F94144', '#F3722C', '#F8961E', '#43AA8B', '#577590',
];

const normalizeRouteKey = (routeId: string) => routeId.startsWith('HSL:') ? routeId.slice(4) : routeId;

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const getUniqueRouteColor = (routeId: string): string => {
  const normalized = normalizeRouteKey(routeId);
  return UNIQUE_ROUTE_COLORS[hashString(normalized) % UNIQUE_ROUTE_COLORS.length];
};

interface ResolveRouteColorParams {
  routeId: string;
  mode: TransportMode;
  colorMode: RouteColorMode;
  isSubscribed: boolean;
}

export const resolveRouteColor = ({ routeId, mode, colorMode, isSubscribed }: ResolveRouteColorParams): string => {
  if (colorMode === 'off') {
    return TRANSPORT_COLORS[mode] ?? TRANSPORT_COLORS.bus;
  }

  if (colorMode === 'favorites') {
    if (isSubscribed) {
      return getUniqueRouteColor(routeId);
    }
    return TRANSPORT_COLORS[mode] ?? TRANSPORT_COLORS.bus;
  }

  return getUniqueRouteColor(routeId);
};

export const getVehicleTerminusLabel = (headsign: string): string => {
  const trimmed = headsign.trim();
  if (!trimmed) return '';

  const segments = trimmed.split(' - ').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length > 1) {
    return segments[segments.length - 1];
  }

  return trimmed;
};
