// Bottom sheet
export const SHEET_MIN_HEIGHT = 80;
export const SHEET_MAX_HEIGHT = 500;
export const SHEET_DEFAULT_HEIGHT = 340;
export const SHEET_EXPAND_THRESHOLD = 160;

// Spring configs
export const SHEET_SPRING = { type: 'spring' as const, stiffness: 400, damping: 40, mass: 0.5 };
export const CARD_LAYOUT_SPRING = { type: 'spring' as const, stiffness: 500, damping: 35, mass: 0.8 };
export const CARD_ENTER_TRANSITION = {
  layout: CARD_LAYOUT_SPRING,
  opacity: { duration: 0.15 },
  scale: { duration: 0.15 },
};

// Geo
export const EARTH_RADIUS_M = 6_371_000;
export const METERS_PER_DEGREE_LAT = 111_320;
export const MPS_TO_KMPH = 3.6;
export const KM_IN_METERS = 1_000;

// Vehicle delay thresholds (seconds)
export const DELAY_LATE_THRESHOLD = 60;
export const DELAY_EARLY_THRESHOLD = -60;

// Vehicle timing — modes with slow update intervals (e.g. ferry ~10s) need larger thresholds
export interface VehicleTiming {
  fadeStartMs: number;
  fadeEndMs: number;
  maxExtrapolateMs: number;
  staleTimeoutMs: number;
  correctionMs: number;
  stationaryThresholdMs: number;
  maxAccelDtSeconds: number;
}

const DEFAULT_TIMING: VehicleTiming = {
  fadeStartMs: 5_000,
  fadeEndMs: 10_000,
  maxExtrapolateMs: 5_000,
  staleTimeoutMs: 10_000,
  correctionMs: 800,
  stationaryThresholdMs: 3_000,
  maxAccelDtSeconds: 10,
};

const SLOW_UPDATE_TIMING: VehicleTiming = {
  fadeStartMs: 15_000,
  fadeEndMs: 30_000,
  maxExtrapolateMs: 15_000,
  staleTimeoutMs: 30_000,
  correctionMs: 2_000,
  stationaryThresholdMs: 15_000,
  maxAccelDtSeconds: 20,
};

export const getVehicleTiming = (mode: string): VehicleTiming =>
  mode === 'ferry' ? SLOW_UPDATE_TIMING : DEFAULT_TIMING;

// Map
export const TOP_BAR_HEIGHT = 48;
export const VEHICLE_FLY_TO_ZOOM = 16;
export const FAB_TOP_OFFSET = 72;

export const MARKER_SIZE_SCALE: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 0.85,
  2: 1,
  3: 1.25,
  4: 1.5,
  5: 2,
};

export const getMarkerSizeScale = (level: 1 | 2 | 3 | 4 | 5): number => MARKER_SIZE_SCALE[level];
