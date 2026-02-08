/** Extract unique terminus/destination names from route longNames (format "A - B") */
export const getStopTermini = (routes: Array<{ longName: string }>): string | null => {
  const termini = new Set<string>();
  for (const r of routes) {
    // HSL longName format: "Origin - Destination" or "Origin-Destination"
    const parts = r.longName.split(/\s*-\s*/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) termini.add(trimmed);
    }
  }
  if (termini.size === 0) return null;
  return Array.from(termini).join(', ');
};
