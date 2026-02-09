# AGENTS.md

## Overview

busmap is a React SPA that tracks Helsinki (HSL) public transport vehicles in real-time on a map. It combines two data sources: the **Digitransit GraphQL API** (routes, stops, timetables) and **HSL's MQTT HFP feed** (live vehicle positions). The app is a PWA with offline caching via Workbox.

## Architecture

### Data Flow

1. **Routes/stops** are fetched via GraphQL (`src/lib/api.ts`) and cached with TanStack React Query (`src/lib/hooks.ts`) + localStorage
2. **Live vehicle positions** stream over WebSocket MQTT (`src/lib/mqtt.ts` → `MqttService` singleton) and are batched (100ms) into Zustand's `vehicleStore`
3. **Vehicle markers** are smoothly animated between MQTT updates using extrapolation + decaying correction offsets (`src/lib/interpolation.ts`)

### Key Modules

| Layer | Files | Purpose |
|-------|-------|---------|
| State | `src/stores/*.ts` | Zustand stores — `vehicleStore` (ephemeral), `subscriptionStore` + `settingsStore` (persisted via `zustand/persist`) |
| Data | `src/lib/api.ts` | All Digitransit GraphQL queries, `normalizeMode()` for HSL mode mapping |
| Data | `src/lib/hooks.ts` | React Query hooks wrapping API calls with caching config |
| Real-time | `src/lib/mqtt.ts` | MQTT connection, HFP topic subscription, vehicle parsing, nearby filtering |
| Animation | `src/lib/interpolation.ts` | Position extrapolation with arc-based heading blend + smooth correction |
| UI | `src/components/*.tsx` | Map (`BusMap`), popovers, bottom sheet, vehicle list, stop details |
| Orchestration | `src/App.tsx` | All state coordination — route subscriptions, temp MQTT management, stop/vehicle selection |

### Subscription Model

Routes have two subscription types managed in `App.tsx`:
- **Permanent** — user-favorited routes stored in `subscriptionStore` (persisted to localStorage)
- **Temporary** — activated via search, stop click, or nearby mode; tracked in `tempMqttRouteIds` / `nearbyMqttRouteIds` refs and cleaned up on deselection

### MQTT Topics

HSL HFP v2 format: `/hfp/v2/journey/ongoing/vp/<mode>/<oper>/<veh>/<route>/<dir>/<headsign>/<start>/<stop>/<geohash_level>/<geohash>/#`

Route IDs use `HSL:` prefix in the app (e.g. `HSL:2551`) but the MQTT topic uses the bare number (`2551`).

### GTFS Direction Mapping

GTFS directions are 0/1 but MQTT uses 1/2 (`mqttDir = gtfsDir + 1`). This conversion happens in `api.ts:fetchStopTimetable`.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
```

Requires `VITE_DIGITRANSIT_API_KEY` in `.env` (register at https://portal-api.digitransit.fi/).

## Conventions

- **Path alias:** `@/*` maps to `./src/*` (configured in both `tsconfig.json` and `vite.config.ts`)
- **Barrel exports:** `src/components/index.ts` and `src/lib/index.ts` re-export public APIs
- **Transport modes:** Always use `normalizeMode()` from `api.ts` when handling mode strings from the API (maps `subway`→`metro`, `rail`→`train`, etc.)
- **Colors:** Use `TRANSPORT_COLORS` from `types.ts` for mode-based coloring
- **Styling:** Tailwind CSS with `dark:` variant; theme applied via `document.documentElement.classList`
- **No test framework** — the project has no test suite

## Patterns to Follow

- Zustand stores use `getState()` outside React and hook selectors inside components to avoid unnecessary re-renders (see `App.tsx` callbacks)
- MQTT message processing batches updates via `vehicleBuffer` + `setTimeout` flush to reduce React re-renders
- Vehicle interpolation uses scoped correction state (`scope` param in `interpolateVehicle`) to isolate animation state between different render contexts
- The `VehicleTiming` config in `constants.ts` provides mode-specific thresholds (ferry has slower update intervals than bus/tram)
