import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore, useSubscriptionStore } from '@/stores';
import { MAP_STYLES } from '@/types';
import type { MapStyle } from '@/types';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsPanelComponent = ({ isOpen, onClose }: SettingsPanelProps) => {
  const historyPushedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      // Clean up history state if panel was closed externally
      if (historyPushedRef.current && window.history.state?.settingsOpen) {
        window.history.back();
      }
      historyPushedRef.current = false;
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    const handlePopState = () => {
      historyPushedRef.current = false;
      onClose();
    };

    if (!historyPushedRef.current) {
      window.history.pushState({ settingsOpen: true }, '');
      historyPushedRef.current = true;
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen, onClose]);

  const {
    showNearby,
    toggleNearby,
    nearbyRadius,
    setNearbyRadius,
    locationRadius,
    setLocationRadius,
    theme,
    setTheme,
    mapStyle,
    setMapStyle,
    showRouteLines,
    setShowRouteLines,
    animateVehicles,
    setAnimateVehicles,
    developerMode,
    setDeveloperMode,
  } = useSettingsStore();

  const clearAllSubscriptions = useSubscriptionStore((state) => state.clearAllSubscriptions);
  const subscribedCount = useSubscriptionStore((state) => state.subscribedRoutes.length);

  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'up-to-date'>('idle');

  const checkForUpdates = useCallback(async () => {
    setUpdateStatus('checking');
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) {
        await registration.update();
        // If no waiting worker appeared, we're up to date
        if (!registration.waiting) {
          setUpdateStatus('up-to-date');
          setTimeout(() => setUpdateStatus('idle'), 3000);
        }
      } else {
        setUpdateStatus('up-to-date');
        setTimeout(() => setUpdateStatus('idle'), 3000);
      }
    } catch {
      setUpdateStatus('idle');
    }
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-white dark:bg-gray-900 shadow-xl z-50 flex flex-col"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* Header */}
            <div className="shrink-0 p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h2>
              <button
                className="w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center"
                onClick={onClose}
              >
                <svg
                  className="w-5 h-5 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Nearby Mode Toggle */}
              <section>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Nearby Mode
                </h3>
                <label className="flex items-center justify-between cursor-pointer p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      Show nearby vehicles
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Display all vehicles around your location in addition to saved routes
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={showNearby}
                    onChange={toggleNearby}
                    className="w-5 h-5 accent-primary-500"
                  />
                </label>
              </section>

              {/* Nearby Radius (only show when nearby mode is active) */}
              {showNearby && (
                <section>
                  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                    Nearby Radius
                  </h3>
                  <div className="space-y-3">
                    <input
                      type="range"
                      min="250"
                      max="4000"
                      step="250"
                      value={nearbyRadius}
                      onChange={(e) => setNearbyRadius(Number(e.target.value))}
                      className="w-full accent-primary-500"
                    />
                    <div className="text-center text-sm text-gray-600 dark:text-gray-300">
                      {nearbyRadius < 1000
                        ? `${nearbyRadius} meters`
                        : `${(nearbyRadius / 1000).toFixed(1)} km`}
                    </div>
                  </div>
                </section>
              )}

              {/* Location Zoom Radius */}
              <section>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Location Zoom Radius
                </h3>
                <div className="space-y-3">
                  <input
                    type="range"
                    min="250"
                    max="4000"
                    step="250"
                    value={locationRadius}
                    onChange={(e) => setLocationRadius(Number(e.target.value))}
                    className="w-full accent-primary-500"
                  />
                  <div className="text-center text-sm text-gray-600 dark:text-gray-300">
                    {locationRadius < 1000
                      ? `${locationRadius} meters`
                      : `${(locationRadius / 1000).toFixed(1)} km`}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    Visible area on startup and when pressing &quot;Go to my location&quot;
                  </div>
                </div>
              </section>

              {/* Appearance */}
              <section>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Appearance
                </h3>
                <div className="space-y-3">
                  {/* Theme */}
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700 dark:text-gray-200">Theme</span>
                    <select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
                      className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>

                  {/* Map style */}
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700 dark:text-gray-200">Map style</span>
                    <select
                      value={mapStyle}
                      onChange={(e) => setMapStyle(e.target.value as MapStyle)}
                      className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm"
                    >
                      {Object.entries(MAP_STYLES).map(([key, { label }]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Show route lines */}
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-gray-700 dark:text-gray-200">Show route lines</span>
                    <input
                      type="checkbox"
                      checked={showRouteLines}
                      onChange={(e) => setShowRouteLines(e.target.checked)}
                      className="w-5 h-5 accent-primary-500"
                    />
                  </label>

                  {/* Animate vehicles */}
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-gray-700 dark:text-gray-200">Animate vehicles</span>
                    <input
                      type="checkbox"
                      checked={animateVehicles}
                      onChange={(e) => setAnimateVehicles(e.target.checked)}
                      className="w-5 h-5 accent-primary-500"
                    />
                  </label>
                </div>
              </section>

              {/* Data */}
              <section>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Data
                </h3>
                <button
                  className="w-full p-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                  onClick={clearAllSubscriptions}
                  disabled={subscribedCount === 0}
                >
                  Clear all saved routes ({subscribedCount})
                </button>
              </section>

              {/* Advanced */}
              <section>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Advanced
                </h3>
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <span className="text-gray-700 dark:text-gray-200">Developer mode</span>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Show extra vehicle details in popovers
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={developerMode}
                    onChange={(e) => setDeveloperMode(e.target.checked)}
                    className="w-5 h-5 accent-primary-500"
                  />
                </label>
              </section>

              {/* About */}
              <section>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  About
                </h3>
                <div className="rounded-xl border-2 border-gray-200 dark:border-gray-700 p-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center shrink-0">
                      <img src="/icon.png" alt="busmap" />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white">busmap</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        v{__APP_VERSION__} &middot; Real-time public transport tracker
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-200 dark:border-gray-700" />

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Developer</span>
                      <a href="https://github.com/FruitieX" target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:underline font-medium">
                        Rasmus Lövegren
                      </a>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Data sources</span>
                      <div className="flex items-center gap-1.5">
                        <a href="https://digitransit.fi/" target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:underline font-medium">
                          Digitransit
                        </a>
                        <span className="text-gray-400 dark:text-gray-500">&middot;</span>
                        <a href="https://www.hsl.fi/" target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:underline font-medium">
                          HSL
                        </a>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={checkForUpdates}
                    disabled={updateStatus === 'checking'}
                    className="flex items-center justify-center gap-2 w-full p-2.5 rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    {updateStatus === 'checking' ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Checking...
                      </>
                    ) : updateStatus === 'up-to-date' ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Up to date
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Check for updates
                      </>
                    )}
                  </button>

                  <a
                    href="https://github.com/FruitieX/busmap-web"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full p-2.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    View on GitHub
                  </a>
                </div>
              </section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export const SettingsPanel = memo(SettingsPanelComponent);
