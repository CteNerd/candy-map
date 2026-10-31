import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Neighborhood, PublicHousePin } from "@candy-map/shared";
import { fetchNeighborhoodHouses, fetchNeighborhoodsNear } from "../lib/api";
import { formatRelativeTime } from "../lib/time";
import { MapLibreMap } from "../map/MapLibreMap";
import type { MapPin } from "../map/MapAdapter";

const POLL_INTERVAL_MS = 20_000; // within the plan's 15-30s polling window
const DEFAULT_CENTER = { lat: 37.7765, lon: -122.428 };

const STATUS_LABEL: Record<PublicHousePin["status"], string> = {
  available: "Available",
  low: "Running low",
  finished: "Finished",
};

export function NeighborhoodMapScreen() {
  const [searchParams] = useSearchParams();
  const [neighborhood, setNeighborhood] = useState<Neighborhood | null>(null);
  const [pins, setPins] = useState<PublicHousePin[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => new Date());
  const [shareCopied, setShareCopied] = useState(false);

  // A share link encodes the point to look up (lat/lon) rather than a neighborhood id directly —
  // COPILOT_PLAN.md's API contract has no "get neighborhood by id" endpoint, only
  // `?lat=&lon=`, so this reuses the exact same public lookup every visitor already does.
  const sharedLat = Number.parseFloat(searchParams.get("lat") ?? "");
  const sharedLon = Number.parseFloat(searchParams.get("lon") ?? "");
  const lookupPoint =
    Number.isFinite(sharedLat) && Number.isFinite(sharedLon) ? { lat: sharedLat, lon: sharedLon } : DEFAULT_CENTER;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const neighborhoods = await fetchNeighborhoodsNear(lookupPoint.lat, lookupPoint.lon);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupPoint.lat, lookupPoint.lon]);

  const mapPins: MapPin[] = pins.map((pin) => ({ id: pin.id, point: pin.point, status: pin.status }));

  async function onShare() {
    if (!neighborhood) return;
    const url = new URL(window.location.origin);
    url.searchParams.set("lat", String(neighborhood.centroid.lat));
    url.searchParams.set("lon", String(neighborhood.centroid.lon));
    await navigator.clipboard.writeText(url.toString());
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  }

  return (
    <div className="screen screen--map">
      <MapLibreMap
        center={neighborhood?.centroid ?? DEFAULT_CENTER}
        boundary={neighborhood?.polygon.coordinates[0]}
        pins={mapPins}
      />
      <div className="card" style={{ margin: "0.75rem", borderRadius: "var(--radius)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <strong>{neighborhood?.name ?? "Loading neighborhood…"}</strong>
          <button className="btn btn--secondary" onClick={onShare} disabled={!neighborhood} style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}>
            {shareCopied ? "Copied!" : "Share"}
          </button>
        </div>
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
