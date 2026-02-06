import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVehicleStore, useSubscriptionStore, useSettingsStore } from '@/stores';
import { useRoutes } from '@/lib';
import type { Route, TransportMode } from '@/types';
import { TRANSPORT_COLORS } from '@/types';

interface StatusBarProps {
  onSelectRoute?: (route: Route) => void;
}

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

const StatusBarComponent = ({ onSelectRoute }: StatusBarProps) => {
  const connectionStatus = useVehicleStore((state) => state.connectionStatus);
  const vehicleCount = useVehicleStore((state) => state.vehicles.size);
  const subscribedCount = useSubscriptionStore((state) => state.subscribedRoutes.length);
  const subscribedRoutes = useSubscriptionStore((state) => state.subscribedRoutes);
  const showNearby = useSettingsStore((state) => state.showNearby);

  const [isSearching, setIsSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Route[]>([]);
  const [selectedMode, setSelectedMode] = useState<TransportMode | 'all'>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const historyPushedRef = useRef(false);
  const { data: routes } = useRoutes();

  const closeSearch = useCallback(() => {
    setIsSearching(false);
    setSearch('');
    setSelectedMode('all');
    setSelectedIndex(0);
  }, []);

  // Focus input when search mode is active
  useEffect(() => {
    if (isSearching) {
      inputRef.current?.focus();
    }
  }, [isSearching]);

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

  // Filter routes based on search and mode, prioritize exact matches
  useEffect(() => {
    if (!routes) {
      setSearchResults([]);
      return;
    }

    let filtered = routes;

    // Filter by mode if not 'all'
    if (selectedMode !== 'all') {
      filtered = filtered.filter((r) => r.mode === selectedMode);
    }

    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase().trim();
      filtered = filtered.filter(
        (r) =>
          r.shortName.toLowerCase().includes(searchLower) ||
          r.longName.toLowerCase().includes(searchLower)
      );

      // Sort: exact shortName matches first, then starts-with, then contains
      filtered = [...filtered].sort((a, b) => {
        const aShort = a.shortName.toLowerCase();
        const bShort = b.shortName.toLowerCase();
        
        // Exact match first
        const aExact = aShort === searchLower;
        const bExact = bShort === searchLower;
        if (aExact && !bExact) return -1;
        if (bExact && !aExact) return 1;
        
        // Starts with second
        const aStarts = aShort.startsWith(searchLower);
        const bStarts = bShort.startsWith(searchLower);
        if (aStarts && !bStarts) return -1;
        if (bStarts && !aStarts) return 1;
        
        // Sort alphabetically by shortName
        return aShort.localeCompare(bShort);
      });
    }

    // Limit results
    setSearchResults(filtered.slice(0, 50));
    setSelectedIndex(0);
  }, [search, routes, selectedMode]);

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
      onSelectRoute?.(route);
      closeSearch();
    },
    [onSelectRoute, closeSearch]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && searchResults.length > 0) {
        e.preventDefault();
        const selectedRoute = searchResults[selectedIndex];
        if (selectedRoute) {
          handleSelectRoute(selectedRoute);
        }
      }
    },
    [searchResults, selectedIndex, handleSelectRoute]
  );

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsRef.current) return;
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
      <div className="mx-4 mt-2 pointer-events-auto">
        <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-xl shadow-float px-4 py-2">
          <div className="flex items-center justify-between">
            {/* Connection status / Search */}
            {isSearching ? (
              <div className="flex-1 flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search routes..."
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
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{vehicleCount}</span>{' '}
                  <span className="hidden sm:inline">{vehicleCount === 1 ? 'vehicle' : 'vehicles'}</span>
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
                {showNearby && (
                  <span className="text-primary-500 font-medium">+<span className="hidden sm:inline"> Nearby</span></span>
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
                {/* Mode filter chips */}
                <div className="flex gap-1.5 mb-2 overflow-x-auto scrollbar-thin pb-1">
                  <button
                    className={`px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                      selectedMode === 'all'
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setSelectedMode('all')}
                  >
                    All
                  </button>
                  {availableModes.map((mode) => (
                    <button
                      key={mode}
                      className={`px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                        selectedMode === mode
                          ? 'text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                      style={selectedMode === mode ? { backgroundColor: TRANSPORT_COLORS[mode] } : {}}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setSelectedMode(mode)}
                    >
                      {MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>

                {/* Results */}
                <div ref={resultsRef} className="max-h-[280px] overflow-y-auto scrollbar-thin">
                {searchResults.length > 0 ? (
                  searchResults.map((route, index) => {
                    const subscribed = isSubscribed(route);
                    const color = TRANSPORT_COLORS[route.mode || 'bus'];
                    const isSelected = index === selectedIndex;
                    return (
                      <button
                        key={route.gtfsId}
                        className={`w-full flex items-center gap-3 py-2 rounded-lg px-2 -mx-2 ${
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
                        <div className="flex-1 text-left">
                          <div className="text-sm text-gray-900 dark:text-white truncate">
                            {route.longName}
                          </div>
                        </div>
                        {subscribed && (
                          <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
                    {search ? 'No routes found' : 'Type to search or select a filter'}
                  </div>
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
