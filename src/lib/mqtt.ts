import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import type { TrackedVehicle, TransportMode, BoundingBox } from '@/types';
import { useVehicleStore } from '@/stores/vehicleStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

const MQTT_BROKER = 'wss://mqtt.hsl.fi:443/';

// HFP topic structure:
// /hfp/v2/journey/ongoing/vp/<transport_mode>/<operator_id>/<vehicle_number>/<route_id>/<direction_id>/<headsign>/<start_time>/<next_stop>/<geohash_level>/<geohash>/#

interface HfpPayload {
  VP?: {
    desi: string; // Route designation (displayed number)
    dir: string; // Direction "1" or "2"
    oper: number; // Operator ID
    veh: number; // Vehicle number
    tst: string; // Timestamp ISO 8601
    tsi: number; // Unix timestamp
    spd: number; // Speed m/s
    hdg: number; // Heading degrees
    lat: number | null;
    long: number | null;
    acc: number; // Acceleration m/s²
    dl: number; // Delay seconds
    odo: number; // Odometer meters
    drst: number; // Door status 0/1
    oday: string; // Operating day YYYY-MM-DD
    jrn: number; // Journey number
    line: number; // Line number
    start: string; // Start time HH:mm
    loc: string; // Location source
    stop: string | null; // Next stop ID
    route: string; // Route ID
    occu: number; // Occupancy 0-100
  };
}

interface PendingNearbyConfig {
  bounds: BoundingBox;
  center: { lat: number; lng: number };
  radius: number;
}

class MqttService {
  private client: MqttClient | null = null;
  private subscriptions = new Set<string>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private currentNearbyTopics: string[] = [];
  private pendingNearbyConfig: PendingNearbyConfig | null = null;

  private vehicleBuffer: TrackedVehicle[] = [];
  private flushScheduled = false;
  private readonly BATCH_INTERVAL_MS = 100;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.client?.connected) {
        resolve();
        return;
      }

      useVehicleStore.getState().setConnectionStatus('connecting');

      const options: IClientOptions = {
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        keepalive: 30,
        clean: true,
      };

      this.client = mqtt.connect(MQTT_BROKER, options);

      this.client.on('connect', () => {
        console.log('MQTT connected');
        this.reconnectAttempts = 0;
        useVehicleStore.getState().setConnectionStatus('connected');

        // Resubscribe to all topics
        this.subscriptions.forEach((topic) => {
          this.client?.subscribe(topic, { qos: 0 });
        });

        // Apply pending nearby config if any (fixes race condition on initial load)
        if (this.pendingNearbyConfig) {
          const { bounds, center, radius } = this.pendingNearbyConfig;
          this.pendingNearbyConfig = null;
          this.setNearbyFilter(center, radius);
          this.subscribeToNearbyArea(bounds);
          console.log('Applied pending nearby config after connection established');
        }

        resolve();
      });

      this.client.on('message', (topic, payload) => {
        this.handleMessage(topic, payload);
      });

      this.client.on('error', (error) => {
        console.error('MQTT error:', error);
        useVehicleStore.getState().setConnectionStatus('error');
      });

      this.client.on('close', () => {
        console.log('MQTT disconnected');
        if (this.client) {
          useVehicleStore.getState().setConnectionStatus('disconnected');
        }
      });

      this.client.on('offline', () => {
        console.log('MQTT offline');
        useVehicleStore.getState().setConnectionStatus('disconnected');
      });

      this.client.on('reconnect', () => {
        this.reconnectAttempts++;
        console.log(`MQTT reconnecting (attempt ${this.reconnectAttempts})`);
        useVehicleStore.getState().setConnectionStatus('connecting');

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('Max reconnect attempts reached');
          this.client?.end();
        }
      });

      // Timeout for initial connection
      setTimeout(() => {
        if (!this.client?.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 15000);
    });
  }

  disconnect() {
    if (this.client) {
      this.subscriptions.clear();
      this.client.end();
      this.client = null;
      useVehicleStore.getState().setConnectionStatus('disconnected');
    }
  }

  subscribeToRoute(routeId: string) {
    // Route ID format: HSL:2551 -> use 2551 in topic
    const shortRouteId = routeId.replace('HSL:', '');

    // Subscribe to both directions
    // Topic format: /hfp/v2/journey/ongoing/vp/<mode>/<oper>/<veh>/<route>/<dir>/<headsign>/<start>/<stop>/<geohash_level>/<geohash>
    const topic = `/hfp/v2/journey/ongoing/vp/+/+/+/${shortRouteId}/+/+/+/+/+/#`;

    if (!this.subscriptions.has(topic)) {
      this.subscriptions.add(topic);
      this.client?.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          console.error(`Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`Subscribed to route ${routeId}`);
        }
      });
    }
  }

  unsubscribeFromRoute(routeId: string) {
    const shortRouteId = routeId.replace('HSL:', '');
    const topic = `/hfp/v2/journey/ongoing/vp/+/+/+/${shortRouteId}/+/+/+/+/+/#`;

    if (this.subscriptions.has(topic)) {
      this.subscriptions.delete(topic);
      this.client?.unsubscribe(topic);
      console.log(`Unsubscribed from route ${routeId}`);

      // Clear vehicles for this route
      useVehicleStore.getState().clearVehiclesForRoute(shortRouteId);
    }
  }

  subscribeToNearbyArea(bounds: BoundingBox) {
    // For nearby mode, subscribe to the entire geohash level (60;24, 60;25, etc.)
    // and filter vehicles client-side based on actual distance
    // This is simpler and more reliable than trying to subscribe to individual cells
    
    const topics: string[] = [];
    
    const latIntMin = Math.floor(bounds.south);
    const latIntMax = Math.floor(bounds.north);
    const lonIntMin = Math.floor(bounds.west);
    const lonIntMax = Math.floor(bounds.east);

    // Get first digit of fractional part for better precision (~11km grid)
    const latFrac1Min = Math.floor((bounds.south % 1) * 10);
    const latFrac1Max = Math.floor((bounds.north % 1) * 10);
    const lonFrac1Min = Math.floor((bounds.west % 1) * 10);
    const lonFrac1Max = Math.floor((bounds.east % 1) * 10);

    for (let latInt = latIntMin; latInt <= latIntMax; latInt++) {
      for (let lonInt = lonIntMin; lonIntMax >= lonInt; lonInt++) {
        // Subscribe at first geohash digit level for ~11km x 6.5km precision
        // Topic format: /hfp/v2/journey/ongoing/vp/<mode>/<oper>/<veh>/<route>/<dir>/<headsign>/<start>/<stop>/<geohash_level>/<geohash>
        for (let latF = latFrac1Min; latF <= latFrac1Max; latF++) {
          for (let lonF = lonFrac1Min; lonF <= lonFrac1Max; lonF++) {
            const topic = `/hfp/v2/journey/ongoing/vp/+/+/+/+/+/+/+/+/+/${latInt};${lonInt}/${latF}${lonF}/#`;
            topics.push(topic);
          }
        }
      }
    }

    // Check if topics are the same as current - avoid spam
    const topicsKey = topics.sort().join(',');
    const currentKey = this.currentNearbyTopics.sort().join(',');
    if (topicsKey === currentKey) {
      return; // No change needed
    }

    // Unsubscribe from old nearby topics
    this.currentNearbyTopics.forEach((topic) => {
      this.subscriptions.delete(topic);
      this.client?.unsubscribe(topic);
    });

    // Subscribe to new topics
    topics.forEach((topic) => {
      if (!this.subscriptions.has(topic)) {
        this.subscriptions.add(topic);
        this.client?.subscribe(topic, { qos: 0 }, (err) => {
          if (err) {
            console.error(`Failed to subscribe to nearby topic:`, err);
          }
        });
      }
    });

    this.currentNearbyTopics = topics;
    console.log(`Subscribed to ${topics.length} nearby area topics:`, topics);
  }

  unsubscribeFromNearbyArea() {
    this.currentNearbyTopics.forEach((topic) => {
      this.subscriptions.delete(topic);
      this.client?.unsubscribe(topic);
    });
    this.currentNearbyTopics = [];
    console.log('Unsubscribed from nearby area');
  }

  // Store location and radius for client-side filtering (circular, not box)
  private nearbyCenter: { lat: number; lng: number } | null = null;
  private nearbyRadius: number = 0;
  // Track if we're paused (tab hidden)
  private isPaused: boolean = false;
  
  setNearbyFilter(center: { lat: number; lng: number } | null, radius: number) {
    this.nearbyCenter = center;
    this.nearbyRadius = radius;
  }

  /**
   * Configure nearby mode atomically - handles connection timing internally.
   * If MQTT is not yet connected, stores the config and applies it on connect.
   * This fixes the race condition where nearby mode is enabled before MQTT connects.
   */
  configureNearby(bounds: BoundingBox, center: { lat: number; lng: number }, radius: number) {
    if (!this.client?.connected) {
      // Store config to apply when connection is established
      this.pendingNearbyConfig = { bounds, center, radius };
      console.log('MQTT not connected, storing nearby config for later');
      return;
    }

    // Apply immediately if connected
    this.setNearbyFilter(center, radius);
    this.subscribeToNearbyArea(bounds);
  }

  /**
   * Clear nearby mode configuration, including any pending config.
   */
  clearNearby() {
    this.pendingNearbyConfig = null;
    this.unsubscribeFromNearbyArea();
    this.setNearbyFilter(null, 0);
  }

  private scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setTimeout(() => this.flushVehicleBuffer(), this.BATCH_INTERVAL_MS);
  }

  private flushVehicleBuffer() {
    this.flushScheduled = false;
    if (this.vehicleBuffer.length === 0) return;

    const batch = this.vehicleBuffer;
    this.vehicleBuffer = [];
    useVehicleStore.getState().updateVehicles(batch);
  }

  // Haversine formula for distance calculation
  private getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private handleMessage(topic: string, payload: Buffer) {
    try {
      const data: HfpPayload = JSON.parse(payload.toString());
      const vp = data.VP;

      if (!vp || vp.lat == null || vp.long == null) {
        return;
      }

      // Skip messages while paused (tab hidden)
      if (this.isPaused) {
        return;
      }

      // Parse transport mode from topic
      const topicParts = topic.split('/');
      const mode = (topicParts[6] || 'bus') as TransportMode;

      // Create vehicle ID from operator and vehicle number
      const vehicleId = `${vp.oper}/${vp.veh}`;

      // Check if this is a subscribed route
      const subscribedRoutes = useSubscriptionStore.getState().subscribedRoutes;
      const isSubscribed = subscribedRoutes.some(
        (r) => r.gtfsId === `HSL:${vp.route}` || r.shortName === vp.desi
      );

      // For non-subscribed vehicles: only process if nearby mode is active
      if (!isSubscribed) {
        // If nearby mode is off, skip all non-subscribed vehicles
        if (!this.nearbyCenter) {
          return;
        }

        // Filter to only those within radius (circular)
        // If a nearby-only vehicle moves outside the radius, mark it for exit
        const distance = this.getDistance(
          this.nearbyCenter.lat, this.nearbyCenter.lng,
          vp.lat, vp.long
        );
        
        if (distance > this.nearbyRadius) {
          // Check if this vehicle was previously tracked - if so, mark for exit
          const existing = useVehicleStore.getState().vehicles.get(vehicleId);
          if (existing && !existing.isSubscribed && !existing.exitingAt) {
            useVehicleStore.getState().updateVehicle({ ...existing, exitingAt: Date.now() });
          }
          return; // Skip this update - outside nearby radius
        }
      }

      const vehicle: TrackedVehicle = {
        vehicleId,
        operatorId: vp.oper,
        vehicleNumber: vp.veh,
        lat: vp.lat,
        lng: vp.long,
        heading: vp.hdg,
        speed: vp.spd,
        acceleration: vp.acc,
        routeId: vp.route,
        routeShortName: vp.desi,
        direction: vp.dir === '2' ? 2 : 1,
        headsign: topicParts[11] || '',
        startTime: vp.start,
        operatingDay: vp.oday,
        delay: vp.dl,
        nextStopId: vp.stop,
        doorStatus: vp.drst as 0 | 1,
        occupancy: vp.occu,
        timestamp: new Date(vp.tst),
        receivedAt: new Date(),
        mode,
        isSubscribed,
        lastUpdate: Date.now(),
        lastPositionUpdate: Date.now(),
      };

      this.vehicleBuffer.push(vehicle);
      this.scheduleFlush();
    } catch {
      // Silently ignore parse errors - some messages may be malformed
    }
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  pause() {
    if (this.isPaused) return;
    this.isPaused = true;
    console.log('MQTT paused (tab hidden)');
  }

  resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    console.log('MQTT resumed (tab visible)');
    
    // Update connection status based on actual client state
    if (this.client?.connected) {
      useVehicleStore.getState().setConnectionStatus('connected');
    } else if (this.client) {
      // Client exists but not connected - trigger reconnect
      useVehicleStore.getState().setConnectionStatus('connecting');
      this.client.reconnect();
    }
  }
}

// Singleton instance
export const mqttService = new MqttService();

// Pause/resume MQTT when tab visibility changes
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      mqttService.pause();
    } else {
      mqttService.resume();
    }
  });
}
