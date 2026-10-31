/**
 * Map rendering is behind a small adapter interface so the "MapLibre now, Amazon Location Service
 * later" decision in COPILOT_PLAN.md is a drop-in swap rather than a rewrite. Screens depend only
 * on `MapView` (see `MapLibreMap.tsx`), never on `maplibre-gl` directly.
 */
import type { GeoPoint, CandyStatus } from "@candy-map/shared";

export interface MapPin {
  id: string;
  point: GeoPoint;
  status: CandyStatus;
}

export interface MapViewProps {
  /** [lon, lat] outer ring of the neighborhood boundary to outline. */
  boundary?: number[][];
  center: GeoPoint;
  pins: MapPin[];
  onPinClick?: (pinId: string) => void;
  className?: string;
}
