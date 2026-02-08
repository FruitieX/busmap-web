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
