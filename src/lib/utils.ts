import { EARTH_RADIUS_M } from '@/constants';

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
