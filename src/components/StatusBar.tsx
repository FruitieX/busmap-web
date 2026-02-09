import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVehicleStore, useSubscriptionStore, useSubscribedStopStore } from '@/stores';
import { useRoutes, getStopTermini } from '@/lib';
import type { Route, TransportMode, Stop, StopRoute } from '@/types';
import { TRANSPORT_COLORS } from '@/types';
import { StarToggleButton } from './StarToggleButton';

interface StatusBarProps {
  onActivateRoute?: (route: Route) => void;
  onToggleRouteSubscription?: (route: Route) => void;
  nearbyStops?: Array<Stop & { distance: number }>;
  onStopClick?: (stop: Stop) => void;
}

type SearchResultItem =
  | { kind: 'route'; route: Route }
  | { kind: 'stop'; stop: Stop & { distance: number } };

const STOP_FILTER_COLOR = '#6366f1'; // indigo — distinct from all transport mode colors

const MODE_ORDER: TransportMode[] = ['bus', 'tram', 'metro', 'train', 'ferry'];
const MODE_LABELS: Record<TransportMode, string> = {
  bus: 'Bus',
  tram: 'Tram',
  train: 'Train',
  metro: 'Metro',
  ferry: 'Ferry',
  ubus: 'U-bus',
  robot: 'Robot',
};

const StatusBarComponent = ({ onActivateRoute, onToggleRouteSubscription, nearbyStops, onStopClick }: StatusBarProps) => {
  const connectionStatus = useVehicleStore((state) => state.connectionStatus);
  const totalVehicleCount = useVehicleStore((state) => state.vehicles.size);
  const subscribedVehicleCount = useVehicleStore((state) => {
    let count = 0;
    for (const v of state.vehicles.values()) {
      if (v.isSubscribed) count++;
    }
    return count;
  });
  const subscribedCount = useSubscriptionStore((state) => state.subscribedRoutes.length);
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const hasExtraVehicles = totalVehicleCount > subscribedVehicleCount;
  const { subscribeToStop, unsubscribeFromStop, isStopSubscribed } = useSubscribedStopStore();

  const [isSearching, setIsSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<TransportMode | 'stops'>>(() => new Set(MODE_ORDER.filter((m) => m !== 'ferry')));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const historyPushedRef = useRef(false);
  const keyboardNavRef = useRef(false);
  const { data: routes } = useRoutes();

  const showStops = activeFilters.has('stops');
  const showRoutes = MODE_ORDER.some((m) => activeFilters.has(m));

  // Build route → minimum distance map from nearby stops
  const routeDistanceMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!nearbyStops) return map;
    for (const stop of nearbyStops) {
      for (const route of stop.routes as StopRoute[]) {
        const existing = map.get(route.gtfsId);
        if (existing === undefined || stop.distance < existing) {
          map.set(route.gtfsId, stop.distance);
        }
      }
    }
    return map;
  }, [nearbyStops]);

  const toggleFilter = useCallback((filter: TransportMode | 'stops') => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
    setSelectedIndex(0);
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearching(false);
    setSearch('');
    setActiveFilters(new Set(MODE_ORDER.filter((m) => m !== 'ferry')));
    setSelectedIndex(0);
  }, []);

  // Focus input when search mode is active
  useEffect(() => {
    if (isSearching) {
      inputRef.current?.focus();
    }
  }, [isSearching]);

  // Dismiss search when clicking outside
  useEffect(() => {
    if (!isSearching) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeSearch();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isSearching, closeSearch]);

  // Handle Escape key and back button to close search
  useEffect(() => {
    if (!isSearching) {
      // Clean up history state if search was closed externally
      if (historyPushedRef.current && window.history.state?.searchOpen) {
        window.history.back();
      }
      historyPushedRef.current = false;
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      }
    };

    const handlePopState = () => {
      historyPushedRef.current = false;
      closeSearch();
    };

    if (!historyPushedRef.current) {
      window.history.pushState({ searchOpen: true }, '');
      historyPushedRef.current = true;
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isSearching, closeSearch]);

  // Unified search results: routes and stops interleaved by match tier + proximity
  const combinedResults = useMemo(() => {
    const searchLower = search.toLowerCase().trim();
    const items: Array<SearchResultItem & { matchTier: number; distance: number; sortName: string }> = [];

    // Add matching routes
    if (showRoutes && routes) {
      let filtered = routes.filter((r) => r.mode && activeFilters.has(r.mode));
      if (searchLower) {
        filtered = filtered.filter(
          (r) =>
            r.shortName.toLowerCase().includes(searchLower) ||
            r.longName.toLowerCase().includes(searchLower),
        );
      }
      for (const route of filtered) {
        const short = route.shortName.toLowerCase();
        let matchTier: number;
        if (!searchLower) {
          matchTier = 3;
        } else if (short === searchLower) {
          matchTier = 0;
        } else if (short.startsWith(searchLower)) {
          matchTier = 1;
        } else {
          matchTier = 2;
        }
        items.push({
          kind: 'route',
          route,
          matchTier,
          distance: routeDistanceMap.get(route.gtfsId) ?? Infinity,
          sortName: short,
        });
      }
    }

    // Add matching stops
    if (showStops && nearbyStops) {
      let filtered = nearbyStops as Array<Stop & { distance: number }>;
      if (searchLower) {
        filtered = filtered.filter(
          (s) =>
            s.name.toLowerCase().includes(searchLower) ||
            s.code.toLowerCase().includes(searchLower),
        );
      }
      for (const stop of filtered) {
        const name = stop.name.toLowerCase();
        const code = stop.code.toLowerCase();
        let matchTier: number;
        if (!searchLower) {
          matchTier = 3;
        } else if (name === searchLower || code === searchLower) {
          matchTier = 0;
        } else if (name.startsWith(searchLower) || code.startsWith(searchLower)) {
          matchTier = 1;
        } else {
          matchTier = 2;
        }
        items.push({
          kind: 'stop',
          stop,
          matchTier,
          distance: stop.distance,
          sortName: name,
        });
      }
    }

    // Sort: match tier → distance → alphabetical
    items.sort((a, b) => {
      if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.sortName.localeCompare(b.sortName);
    });

    return items.slice(0, 50);
  }, [search, routes, nearbyStops, activeFilters, showRoutes, showStops, routeDistanceMap]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [search, activeFilters]);

  // Available modes in the data
  const availableModes = useMemo(() => {
    if (!routes) return [];
    const modes = new Set(routes.map((r) => r.mode).filter(Boolean));
    return MODE_ORDER.filter((m) => modes.has(m));
  }, [routes]);

  const handleSearchClick = useCallback(() => {
    setIsSearching(true);
  }, []);


  const handleSelectRoute = useCallback(
    (route: Route) => {
      onActivateRoute?.(route);
      closeSearch();
    },
    [onActivateRoute, closeSearch]
  );

  const handleRouteSubscriptionToggle = useCallback(
    (route: Route) => {
      onToggleRouteSubscription?.(route);
    },
    [onToggleRouteSubscription],
  );

  const handleStopSelect = useCallback(
    (stop: Stop) => {
      onStopClick?.(stop);
      closeSearch();
    },
    [onStopClick, closeSearch],
  );

  const handleStopSubscriptionToggle = useCallback(
    (stop: Stop) => {
      if (isStopSubscribed(stop.gtfsId)) {
        unsubscribeFromStop(stop.gtfsId);
      } else {
        subscribeToStop(stop);
      }
    },
    [subscribeToStop, unsubscribeFromStop, isStopSubscribed],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const maxIndex = combinedResults.length - 1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        keyboardNavRef.current = true;
        setSelectedIndex((prev) => Math.min(prev + 1, maxIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        keyboardNavRef.current = true;
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = combinedResults[selectedIndex];
        if (!item) return;
        if (item.kind === 'route') {
          handleRouteSubscriptionToggle(item.route);
        } else {
          handleStopSubscriptionToggle(item.stop);
        }
      }
    },
    [combinedResults, selectedIndex, handleRouteSubscriptionToggle, handleStopSubscriptionToggle],
  );

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsRef.current || !keyboardNavRef.current) return;
    keyboardNavRef.current = false;
    const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
    selectedElement?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const isSubscribed = useCallback(
    (route: Route) => subscribedRoutes.some((r) => r.gtfsId === route.gtfsId),
    [subscribedRoutes]
  );

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
        return 'bg-yellow-500 animate-pulse';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Live';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Error';
      default:
        return 'Offline';
    }
  };

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 z-50 pointer-events-none"
      style={{ paddingTop: 'var(--safe-area-inset-top)' }}
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2 }}
    >
      <div className="mx-4 mt-2 pointer-events-auto" ref={containerRef}>
        <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-xl shadow-float px-4 py-2">
          <div className="flex items-center justify-between">
            {/* Connection status / Search */}
            {isSearching ? (
              <div className="flex-1 flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search routes & stops..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 bg-transparent text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none text-sm cursor-text"
                />
                <button
                  className="shrink-0 w-6 h-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={closeSearch}
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                className="flex items-center gap-2 flex-1 cursor-text min-w-0"
                onClick={handleSearchClick}
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${getStatusColor()}`} />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 shrink-0">
                  {getStatusText()}
                </span>
                <span className="text-gray-400 mx-1 sm:mx-2 shrink-0">|</span>
                <svg
                  className="w-4 h-4 text-gray-400 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">Search routes</span>
                <span className="text-sm text-gray-500 dark:text-gray-400 sm:hidden">Search</span>
              </button>
            )}

            {/* Stats */}
            {!isSearching && (
              <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-gray-500 dark:text-gray-400 shrink-0">
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{subscribedVehicleCount}</span>{' '}
                  <span className="hidden sm:inline">{subscribedVehicleCount === 1 ? 'vehicle' : 'vehicles'}</span>
                  <svg className="w-3.5 h-3.5 sm:hidden" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/>
                  </svg>
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{subscribedCount}</span>{' '}
                  <span className="hidden sm:inline">{subscribedCount === 1 ? 'route' : 'routes'}</span>
                  <svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </span>
                {hasExtraVehicles && (
                  <span className="text-primary-500 font-medium">+</span>
                )}
              </div>
            )}
          </div>

          {/* Search results dropdown */}
          <AnimatePresence>
            {isSearching && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                {/* Filter chips — multi-select, all active by default */}
                <div className="flex gap-1 mb-2 overflow-x-auto scrollbar-thin pb-1">
                  <button
                    className={`px-2.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                      showStops
                        ? 'text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    style={showStops ? { backgroundColor: STOP_FILTER_COLOR } : {}}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggleFilter('stops')}
                  >
                    Stops
                  </button>
                  {availableModes.map((mode) => (
                    <button
                      key={mode}
                      className={`px-2.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                        activeFilters.has(mode)
                          ? 'text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                      style={activeFilters.has(mode) ? { backgroundColor: TRANSPORT_COLORS[mode] } : {}}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => toggleFilter(mode)}
                    >
                      {MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>

                {/* Results — unified and sorted by match tier + proximity */}
                <div ref={resultsRef} className="max-h-[280px] overflow-y-auto overflow-x-hidden scrollbar-thin">
                {combinedResults.length === 0 ? (
                  <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
                    {search ? 'No results found' : 'Type to search or select a filter'}
                  </div>
                ) : (
                  <>
                  {combinedResults.map((item, index) => {
                    const isSelected = index === selectedIndex;
                    if (item.kind === 'route') {
                      const { route } = item;
                      const subscribed = isSubscribed(route);
                      const color = TRANSPORT_COLORS[route.mode || 'bus'];
                      return (
                        <div
                          key={route.gtfsId}
                          role="button"
                          tabIndex={0}
                          className={`w-full flex items-center gap-3 py-2 rounded-lg px-2 cursor-pointer ${
                            isSelected
                              ? 'bg-gray-100 dark:bg-gray-800'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                          onClick={() => handleSelectRoute(route)}
                          onMouseEnter={() => setSelectedIndex(index)}
                        >
                          <div
                            className="w-10 h-8 rounded-md flex items-center justify-center text-white font-bold text-sm shrink-0"
                            style={{ backgroundColor: color }}
                          >
                            {route.shortName}
                          </div>
                          <div className="flex-1 text-left min-w-0 h-8 flex items-center">
                            <span className="text-sm text-gray-900 dark:text-white truncate">
                              {route.longName}
                            </span>
                          </div>
                          <StarToggleButton
                            active={subscribed}
                            onToggle={() => handleRouteSubscriptionToggle(route)}
                            title={subscribed ? 'Stop tracking' : 'Track this route'}
                            size="sm"
                          />
                        </div>
                      );
                    } else {
                      const { stop } = item;
                      const stopSubscribed = isStopSubscribed(stop.gtfsId);
                      const color = TRANSPORT_COLORS[stop.vehicleMode] ?? TRANSPORT_COLORS.bus;
                      return (
                        <div
                          key={stop.gtfsId}
                          role="button"
                          tabIndex={0}
                          className={`w-full flex items-center gap-3 py-2 rounded-lg px-2 cursor-pointer ${
                            isSelected
                              ? 'bg-gray-100 dark:bg-gray-800'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                          onClick={() => handleStopSelect(stop)}
                          onMouseEnter={() => setSelectedIndex(index)}
                        >
                          <div
                            className="w-10 h-8 rounded-md flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `${color}20`, border: `1.5px solid ${color}` }}
                          >
                            <svg className="w-4 h-4" fill={color} viewBox="0 0 24 24">
                              <path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 14 8 14s8-8.75 8-14c0-4.42-3.58-8-8-8zm0 11c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" />
                            </svg>
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <div className="text-sm text-gray-900 dark:text-white truncate">
                              {stop.name}
                              {stop.code && (
                                <span className="text-xs text-gray-400 ml-1">{stop.code}</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 capitalize truncate">
                              {stop.vehicleMode} • {stop.routes.length} routes
                            </div>
                            {(() => {
                              const termini = getStopTermini(stop.routes, stop.headsigns);
                              return termini ? (
                                <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate" title={termini}>
                                  {termini}
                                </div>
                              ) : null;
                            })()}
                          </div>
                          <StarToggleButton
                            active={stopSubscribed}
                            onToggle={() => handleStopSubscriptionToggle(stop)}
                            title={stopSubscribed ? 'Remove stop' : 'Save this stop'}
                            size="sm"
                          />
                        </div>
                      );
                    }
                  })}
                  </>
                )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

export const StatusBar = memo(StatusBarComponent);
