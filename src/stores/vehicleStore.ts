import { create } from 'zustand';
import type { TrackedVehicle, ConnectionStatus } from '@/types';

const STALE_TIMEOUT = 10_000;

// Duration for exit animation in ms
const EXIT_ANIMATION_MS = 300;

// Haversine formula for distance calculation
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

interface VehicleState {
  // All tracked vehicles by vehicleId
  vehicles: Map<string, TrackedVehicle>;

  // Connection status
  connectionStatus: ConnectionStatus;
  lastConnected: number | null;

  // Stats
  messageCount: number;

  // Actions
  updateVehicle: (vehicle: TrackedVehicle) => void;
  removeVehicle: (vehicleId: string) => void;
  removeStaleVehicles: () => void;
  clearVehicles: () => void;
  clearVehiclesForRoute: (routeId: string) => void;
  markNearbyVehiclesForExit: (center: { lat: number; lng: number }, radius: number) => void;
  clearNearbyVehicles: () => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  incrementMessageCount: () => void;

  // Selectors
  getVehiclesArray: () => TrackedVehicle[];
  getVehiclesByRoute: (routeId: string) => TrackedVehicle[];
  getSubscribedVehicles: () => TrackedVehicle[];
  getNearbyVehicles: () => TrackedVehicle[];
}

export const useVehicleStore = create<VehicleState>((set, get) => ({
  vehicles: new Map(),
  connectionStatus: 'disconnected',
  lastConnected: null,
  messageCount: 0,

  updateVehicle: (vehicle) => {
    set((state) => {
      const vehicles = new Map(state.vehicles);
      const existing = vehicles.get(vehicle.vehicleId);

      if (existing) {
        // Only recompute motion derivatives when position actually changed
        const posChanged = vehicle.lat !== existing.lat || vehicle.lng !== existing.lng;

        if (posChanged) {
          vehicle.prevLat = existing.lat;
          vehicle.prevLng = existing.lng;
          vehicle.prevHeading = existing.heading;
          vehicle.animationStart = Date.now();

          // Store raw reported heading for turn prediction
          vehicle.reportedHeading = vehicle.heading;

          // Compute heading from velocity vector (more stable than reported heading)
          const dlat = vehicle.lat - existing.lat;
          const dlng = vehicle.lng - existing.lng;
          const dist = Math.sqrt(dlat * dlat + dlng * dlng);
          if (dist > 1e-7 && vehicle.speed > 0.3) {
            const bearing = (Math.atan2(dlng, dlat) * 180) / Math.PI;
            vehicle.heading = ((bearing % 360) + 360) % 360;
          }

          // Compute speed acceleration from consecutive samples
          const dt = (Date.now() - existing.lastPositionUpdate) / 1000;
          if (dt > 0 && dt < 10) {
            vehicle.speedAcceleration = Math.max(-5, Math.min(5, (vehicle.speed - existing.speed) / dt));
          } else {
            vehicle.speedAcceleration = 0;
          }

          vehicle.lastPositionUpdate = Date.now();
        } else {
          // Position unchanged — preserve extrapolation state
          vehicle.lastPositionUpdate = existing.lastPositionUpdate;
          vehicle.heading = existing.heading;
          vehicle.reportedHeading = existing.reportedHeading;
          vehicle.speedAcceleration = existing.speedAcceleration;
          vehicle.prevLat = existing.prevLat;
          vehicle.prevLng = existing.prevLng;
          vehicle.prevHeading = existing.prevHeading;
          vehicle.animationStart = existing.animationStart;
        }

        vehicle.lastUpdate = Date.now();
      } else {
        vehicle.lastUpdate = Date.now();
        vehicle.lastPositionUpdate = Date.now();
      }
      vehicles.set(vehicle.vehicleId, vehicle);

      return { vehicles };
    });
  },

  removeVehicle: (vehicleId) => {
    set((state) => {
      const vehicles = new Map(state.vehicles);
      vehicles.delete(vehicleId);
      return { vehicles };
    });
  },

  removeStaleVehicles: () => {
    const now = Date.now();
    set((state) => {
      const vehicles = new Map(state.vehicles);
      let removed = false;

      for (const [id, vehicle] of vehicles) {
        // Remove if stale OR if exit animation has completed
        const isStale = now - vehicle.lastUpdate > STALE_TIMEOUT;
        const exitComplete = vehicle.exitingAt && now - vehicle.exitingAt > EXIT_ANIMATION_MS;
        if (isStale || exitComplete) {
          vehicles.delete(id);
          removed = true;
        }
      }

      return removed ? { vehicles } : state;
    });
  },

  clearVehicles: () => {
    set({ vehicles: new Map() });
  },

  clearVehiclesForRoute: (routeId) => {
    set((state) => {
      const vehicles = new Map(state.vehicles);
      for (const [id, vehicle] of vehicles) {
        if (vehicle.routeId === routeId) {
          vehicles.delete(id);
        }
      }
      return { vehicles };
    });
  },

  markNearbyVehiclesForExit: (center, radius) => {
    const now = Date.now();
    set((state) => {
      const vehicles = new Map(state.vehicles);
      let changed = false;

      for (const [id, vehicle] of vehicles) {
        // Only affect nearby-only vehicles (not subscribed)
        if (vehicle.isSubscribed || vehicle.exitingAt) continue;

        const distance = getDistance(center.lat, center.lng, vehicle.lat, vehicle.lng);
        if (distance > radius) {
          vehicles.set(id, { ...vehicle, exitingAt: now });
          changed = true;
        }
      }

      return changed ? { vehicles } : state;
    });
  },

  clearNearbyVehicles: () => {
    const now = Date.now();
    set((state) => {
      const vehicles = new Map(state.vehicles);
      let changed = false;

      for (const [id, vehicle] of vehicles) {
        // Mark all nearby-only vehicles for exit
        if (!vehicle.isSubscribed && !vehicle.exitingAt) {
          vehicles.set(id, { ...vehicle, exitingAt: now });
          changed = true;
        }
      }

      return changed ? { vehicles } : state;
    });
  },

  setConnectionStatus: (connectionStatus) => {
    set((state) => {
      // Ignore disconnected status if we just connected (< 500ms) - prevents race condition
      // where close/offline events fire during initial connection setup
      if (
        connectionStatus === 'disconnected' &&
        state.lastConnected &&
        Date.now() - state.lastConnected < 500
      ) {
        return state;
      }
      return {
        connectionStatus,
        lastConnected: connectionStatus === 'connected' ? Date.now() : state.lastConnected,
      };
    });
  },

  incrementMessageCount: () => {
    set((state) => ({ messageCount: state.messageCount + 1 }));
  },

  // Selectors
  getVehiclesArray: () => {
    return Array.from(get().vehicles.values());
  },

  getVehiclesByRoute: (routeId) => {
    return Array.from(get().vehicles.values()).filter((v) => v.routeId === routeId);
  },

  getSubscribedVehicles: () => {
    return Array.from(get().vehicles.values()).filter((v) => v.isSubscribed);
  },

  getNearbyVehicles: () => {
    return Array.from(get().vehicles.values()).filter((v) => !v.isSubscribed);
  },
}));

// Set up stale vehicle cleanup interval
if (typeof window !== 'undefined') {
  setInterval(() => {
    useVehicleStore.getState().removeStaleVehicles();
  }, 5000);
}
