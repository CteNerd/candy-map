/** Provider-independent map inputs; domain coordinates remain [longitude, latitude]. */
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
  selectedPoint?: GeoPoint;
  userLocation?: GeoPoint;
  draftPath?: GeoPoint[];
  onMapClick?: (point: GeoPoint) => void;
  onCenterChange?: (point: GeoPoint) => void;
}
