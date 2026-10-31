import { useEffect, useState } from "react";
import type { Neighborhood, PublicHousePin } from "@candy-map/shared";
import { fetchNeighborhoodHouses, fetchNeighborhoodsNear } from "../lib/api";
import { formatRelativeTime } from "../lib/time";
import { MapLibreMap } from "../map/MapLibreMap";
import type { MapPin } from "../map/MapAdapter";

const POLL_INTERVAL_MS = 20_000; // within the plan's 15-30s polling window

const STATUS_LABEL: Record<PublicHousePin["status"], string> = {
  available: "Available",
  low: "Running low",
  finished: "Finished",
};

export function NeighborhoodMapScreen() {
  const [neighborhood, setNeighborhood] = useState<Neighborhood | null>(null);
  const [pins, setPins] = useState<PublicHousePin[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => new Date());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const neighborhoods = await fetchNeighborhoodsNear(37.7765, -122.428);
      const first = neighborhoods[0] ?? null;
      if (cancelled || !first) return;
      setNeighborhood(first);
      const housePins = await fetchNeighborhoodHouses(first.id);
      if (cancelled) return;
      setPins(housePins);
      setLastRefreshed(new Date());
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const mapPins: MapPin[] = pins.map((pin) => ({ id: pin.id, point: pin.point, status: pin.status }));

  return (
    <div className="screen screen--map">
      <MapLibreMap
        center={neighborhood?.centroid ?? { lat: 37.7765, lon: -122.428 }}
        boundary={neighborhood?.polygon.coordinates[0]}
        pins={mapPins}
      />
      <div className="card" style={{ margin: "0.75rem", borderRadius: "var(--radius)" }}>
        <strong>{neighborhood?.name ?? "Loading neighborhood…"}</strong>
        <p className="muted">
          {pins.length} house{pins.length === 1 ? "" : "s"} opted in · refreshed {formatRelativeTime(lastRefreshed.toISOString())}
        </p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {pins.map((pin) => (
            <li key={pin.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className={`pill pill--${pin.status}`}>{STATUS_LABEL[pin.status]}</span>
              <span className="muted">{formatRelativeTime(pin.updatedAt)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
