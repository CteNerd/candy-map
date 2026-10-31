import { useCallback, useState } from "react";
import type { GeoPoint } from "@candy-map/shared";

export const DEFAULT_CENTER: GeoPoint = { lat: 37.7765, lon: -122.428 };

export function parsePoint(lat: string | null, lon: string | null): GeoPoint | null {
  if (!lat?.trim() || !lon?.trim()) return null;
  const point = { lat: Number(lat), lon: Number(lon) };
  return Number.isFinite(point.lat) && Math.abs(point.lat) <= 85
    && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180 ? point : null;
}

export function useLocation(onLocate: (point: GeoPoint) => void) {
  const [location, setLocation] = useState<GeoPoint>();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const locate = useCallback(() => {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("Location is unavailable in this browser. Search an address or choose a point on the map.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((position) => {
      const point = { lat: position.coords.latitude, lon: position.coords.longitude };
      setLocation(point);
      setLocating(false);
      onLocate(point);
    }, (error) => {
      setLocating(false);
      setLocationError(error.code === 1
        ? "Location permission was denied. Enable it in browser settings, or search an address."
        : error.code === 3 ? "Location request timed out. Try again or search an address."
          : "Could not determine your location. Search an address or choose a point on the map.");
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  }, [onLocate]);
  return { location, locating, locationError, locate };
}
