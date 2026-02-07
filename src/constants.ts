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

// Map
export const TOP_BAR_HEIGHT = 48;
export const VEHICLE_FLY_TO_ZOOM = 16;
export const FAB_TOP_OFFSET = 72;
