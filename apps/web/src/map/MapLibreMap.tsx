import { useEffect, useRef } from "react";
import { Map as MapLibreMapInstance, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapViewProps } from "./MapAdapter";

setWorkerUrl(workerUrl);

/**
 * Demo vector-tile style published by the MapLibre project itself, specifically intended for
 * testing/demos (no API key, no production SLA). Swap this for a licensed tile provider or the
 * Amazon Location Service adapter before shipping past the POC — see README "Known limitations".
 */
const DEMO_STYLE_URL = "https://demotiles.maplibre.org/style.json";

const STATUS_COLOR: Record<string, string> = {
  available: "#22c55e",
  low: "#f59e0b",
  finished: "#6b7280",
};

export function MapLibreMap({ boundary, center, pins, onPinClick, className }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMapInstance | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMapInstance({
      container: containerRef.current,
      style: DEMO_STYLE_URL,
      center: [center.lon, center.lat],
      zoom: 15,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Map is created once; center/boundary/pins updates below reposition it rather than recreate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function drawBoundary() {
      if (!map) return;
      const sourceId = "neighborhood-boundary";
      if (!boundary) {
        if (map.getLayer(`${sourceId}-fill`)) map.removeLayer(`${sourceId}-fill`);
        if (map.getLayer(`${sourceId}-line`)) map.removeLayer(`${sourceId}-line`);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        return;
      }
      const data = {
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: [boundary] },
        properties: {},
      };
      const existing = map.getSource(sourceId);
      if (existing && "setData" in existing) {
        (existing as GeoJSONSource).setData(data);
      } else {
        map.addSource(sourceId, { type: "geojson", data });
        map.addLayer({
          id: `${sourceId}-fill`,
          type: "fill",
          source: sourceId,
          paint: { "fill-color": "#7c3aed", "fill-opacity": 0.15 },
        });
        map.addLayer({
          id: `${sourceId}-line`,
          type: "line",
          source: sourceId,
          paint: { "line-color": "#7c3aed", "line-width": 2 },
        });
      }
    }

    if (map.isStyleLoaded()) {
      drawBoundary();
    } else {
      map.once("load", drawBoundary);
    }
  }, [boundary]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = pins.map((pin) => {
      const el = document.createElement("button");
      el.setAttribute("aria-label", `Candy house, status ${pin.status}`);
      el.style.width = "18px";
      el.style.height = "18px";
      el.style.borderRadius = "50%";
      el.style.border = "2px solid white";
      el.style.background = STATUS_COLOR[pin.status] ?? STATUS_COLOR.available!;
      el.style.cursor = "pointer";
      el.style.padding = "0";
      if (onPinClick) {
        el.addEventListener("click", () => onPinClick(pin.id));
      }
      return new Marker({ element: el })
        .setLngLat([pin.point.lon, pin.point.lat])
        .addTo(map);
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [pins, onPinClick]);

  return <div ref={containerRef} className={className ?? "map-container"} data-testid="map-container" />;
}
