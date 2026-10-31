import { useEffect, useRef, useState } from "react";
import type { MapViewProps } from "./MapAdapter";
import { GOOGLE_MAP_ID, loadGoogleLibrary } from "./googleMaps";

const COLORS = { available: "#22c55e", low: "#f59e0b", finished: "#6b7280" };

export function GoogleMap({
  center, boundary, pins, onPinClick, className, selectedPoint, userLocation,
  draftPath, onMapClick, onCenterChange,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialCenter = useRef(center);

  useEffect(() => {
    let active = true;
    let instance: google.maps.Map | undefined;
    const authFailure = () => {
      if (active) setError("Google Maps authorization failed. Check the API key, allowed website, enabled API and billing.");
    };
    window.addEventListener("google-maps-auth-failure", authFailure);
    Promise.all([loadGoogleLibrary("maps"), loadGoogleLibrary("marker")]).then(([{ Map }]) => {
      if (!active || !container.current) return;
      instance = new Map(container.current, {
        center: { lat: initialCenter.current.lat, lng: initialCenter.current.lon },
        zoom: 16, mapId: GOOGLE_MAP_ID, mapTypeControl: false, streetViewControl: false,
        fullscreenControl: true, gestureHandling: "cooperative",
      });
      setMap(instance);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Could not load Google Maps.");
    });
    return () => {
      active = false;
      window.removeEventListener("google-maps-auth-failure", authFailure);
      if (instance) google.maps.event.clearInstanceListeners(instance);
    };
  }, []);

  useEffect(() => {
    map?.panTo({ lat: center.lat, lng: center.lon });
  }, [map, center.lat, center.lon]);

  useEffect(() => {
    if (!map) return;
    const click = map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (event.latLng) onMapClick?.({ lat: event.latLng.lat(), lon: event.latLng.lng() });
    });
    const idle = map.addListener("idle", () => {
      const point = map.getCenter();
      if (point) onCenterChange?.({ lat: point.lat(), lon: point.lng() });
    });
    return () => { click.remove(); idle.remove(); };
  }, [map, onMapClick, onCenterChange]);

  useEffect(() => {
    if (!map || !boundary) return;
    const polygon = new google.maps.Polygon({
      map, paths: boundary.map(([lng, lat]) => ({ lat: lat!, lng: lng! })),
      strokeColor: "#7c3aed", strokeWeight: 2, fillColor: "#7c3aed", fillOpacity: 0.12,
      clickable: false,
    });
    return () => polygon.setMap(null);
  }, [map, boundary]);

  useEffect(() => {
    if (!map || !draftPath?.length) return;
    const paths = draftPath.map((point) => ({ lat: point.lat, lng: point.lon }));
    const outline = draftPath.length >= 3
      ? new google.maps.Polygon({ map, paths, strokeColor: "#ff7a1a", fillColor: "#ff7a1a", fillOpacity: 0.2, clickable: false })
      : new google.maps.Polyline({ map, path: paths, strokeColor: "#ff7a1a", clickable: false });
    const vertices = paths.map((position, index) => new google.maps.marker.AdvancedMarkerElement({
      map, position, title: `Boundary corner ${index + 1}`,
    }));
    return () => { outline.setMap(null); vertices.forEach((marker) => { marker.map = null; }); };
  }, [map, draftPath]);

  useEffect(() => {
    if (!map) return;
    const markers = pins.map((pin) => {
      const button = document.createElement("button");
      button.className = "candy-marker";
      button.style.backgroundColor = COLORS[pin.status];
      button.setAttribute("aria-label", `Candy house, status ${pin.status}`);
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map, position: { lat: pin.point.lat, lng: pin.point.lon }, content: button,
        title: `Candy house: ${pin.status}`,
      });
      button.addEventListener("click", () => onPinClick?.(pin.id));
      return marker;
    });
    return () => markers.forEach((marker) => { marker.map = null; });
  }, [map, pins, onPinClick]);

  useEffect(() => {
    if (!map || !selectedPoint) return;
    const marker = new google.maps.marker.AdvancedMarkerElement({
      map, position: { lat: selectedPoint.lat, lng: selectedPoint.lon }, title: "Selected house location",
    });
    return () => { marker.map = null; };
  }, [map, selectedPoint]);

  useEffect(() => {
    if (!map || !userLocation) return;
    const dot = document.createElement("div");
    dot.className = "location-marker";
    const marker = new google.maps.marker.AdvancedMarkerElement({
      map, position: { lat: userLocation.lat, lng: userLocation.lon }, content: dot, title: "Your location",
    });
    return () => { marker.map = null; };
  }, [map, userLocation]);

  return (
    <div className={className ?? "map-container"}>
      {!map && !error && <p className="banner" role="status">Loading Google Maps...</p>}
      {error && <p className="banner" role="alert">{error}</p>}
      <div ref={container} className="google-map-canvas" data-testid="map-container" />
    </div>
  );
}
