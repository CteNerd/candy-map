import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EVENT_STATUS_LABELS, isPointInPolygon, type GeoPoint, type PublicNeighborhood, type PublicEventPin } from "@candy-map/shared";
import { fetchNeighborhoodHouses, fetchNeighborhoodsNear } from "../lib/api";
import { formatRelativeTime } from "../lib/time";
import { GoogleMap } from "../map/GoogleMap";
import type { MapPin } from "../map/MapAdapter";
import { AddressSearch } from "../map/AddressSearch";
import { DEFAULT_CENTER, parsePoint, useLocation } from "../map/useLocation";
import { useEventEdition } from "../lib/useEventEdition";

const POLL_INTERVAL_MS = 20_000; // within the plan's 15-30s polling window

export function NeighborhoodMapScreen() {
  const { eventId } = useEventEdition();
  return <NeighborhoodMapForEvent key={eventId} />;
}

function NeighborhoodMapForEvent() {
  const { edition, eventId, lifecycle, eventError } = useEventEdition();
  const [searchParams] = useSearchParams();
  const [neighborhood, setNeighborhood] = useState<PublicNeighborhood | null>(null);
  const [pins, setPins] = useState<PublicEventPin[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => new Date());
  const [shareCopied, setShareCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const sharedPoint = useMemo(() => parsePoint(searchParams.get("lat"), searchParams.get("lon")), [searchParams]);
  const [lookupPoint, setLookupPoint] = useState(sharedPoint ?? DEFAULT_CENTER);
  const [areaCenter, setAreaCenter] = useState<GeoPoint>(lookupPoint);
  const { location, locating, locationError, locate } = useLocation(setLookupPoint);
  const selectArea = useCallback((point: GeoPoint) => setAreaCenter(point), []);

  // A share link encodes the point to look up (lat/lon) rather than a neighborhood id directly —
  // COPILOT_PLAN.md's API contract has no "get neighborhood by id" endpoint, only
  // `?lat=&lon=`, so this reuses the exact same public lookup every visitor already does.
  useEffect(() => {
    if (sharedPoint) setLookupPoint(sharedPoint);
  }, [sharedPoint]);

  useEffect(() => {
    let active = true;
    if (!sharedPoint && navigator.permissions) {
      navigator.permissions.query({ name: "geolocation" }).then((permission) => {
        if (active && permission.state === "granted") locate();
      }).catch(() => {
        if (active) setError("Automatic location checking is unavailable. Use the location button or search an address.");
      });
    }
    return () => { active = false; };
  }, [sharedPoint, locate]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setNeighborhood(null);
    setPins([]);
    setSelectedPin(null);
    if (eventError) return;

    async function load() {
      try {
        const neighborhoods = await fetchNeighborhoodsNear(lookupPoint.lat, lookupPoint.lon);
        const first = neighborhoods.find((item) => item.id === searchParams.get("neighborhood"))
          ?? neighborhoods.find((item) => isPointInPolygon(lookupPoint, item.polygon))
          ?? neighborhoods[0] ?? null;
        if (cancelled) return;
        setError(null);
        setLoaded(true);
        setNeighborhood(first);
        if (!first) {
          setPins([]);
          return;
        }
        const housePins = await fetchNeighborhoodHouses(first.id, eventId);
        if (cancelled) return;
        setPins(housePins);
        setLastRefreshed(new Date());
      } catch (err) {
        if (!cancelled) {
          setPins([]);
          setError(err instanceof Error ? err.message : "Could not load the map.");
        }
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupPoint.lat, lookupPoint.lon, searchParams, eventId, eventError]);

  const mapPins: MapPin[] = useMemo(() => pins.map((pin) => ({ id: pin.id, point: pin.point, status: pin.status })), [pins]);

  async function onShare() {
    if (!neighborhood) return;
    const url = new URL("/map", window.location.origin);
    url.searchParams.set("lat", String(neighborhood.centroid.lat));
    url.searchParams.set("lon", String(neighborhood.centroid.lon));
    url.searchParams.set("neighborhood", neighborhood.id);
    url.searchParams.set("eventId", eventId);
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      setError("Could not copy the link. Check clipboard permission and try again.");
    }
  }

  return (
    <div className="screen screen--map">
      <div className="map-toolbar">
        <p className="event-summary"><strong>{edition.icon} {edition.label}</strong> · {lifecycle === "past" ? "Ended" : lifecycle === "upcoming" ? "Upcoming" : "Active"}</p>
        {eventError && <p className="banner" role="alert">{eventError}</p>}
        {!eventError && lifecycle === "past" && <p className="banner">This holiday has ended. Live listings are hidden. Public house archives are not available yet.</p>}
        {!eventError && lifecycle === "upcoming" && <p className="banner">This holiday has not started. Residents can save their own edition-specific participation.</p>}
        <p className="muted">Dates use {edition.timezone}. {edition.type === "christmas-lights" ? "November 1 through January 6. A listed display is not confirmation that lights are on now or an invitation onto private property." : "October 31. Only active candy updates appear."}</p>
        <Link to="/privacy">Remove or block a property</Link>
        <AddressSearch onSelect={({ point }) => setLookupPoint(point)} />
        <div className="button-row">
          <button className="btn" onClick={locate} disabled={locating}>{locating ? "Locating..." : "Use my location"}</button>
          <button className="btn btn--secondary" onClick={() => setLookupPoint(areaCenter)}>Search this area</button>
          <Link to={`/neighborhoods/new?eventId=${encodeURIComponent(eventId)}`} className="btn btn--secondary">Add neighborhood</Link>
        </div>
        {locationError && <p className="muted" role="alert">{locationError}</p>}
      </div>
      <GoogleMap
        center={lookupPoint}
        boundary={neighborhood?.polygon.coordinates[0]}
        pins={mapPins}
        userLocation={location}
        onPinClick={setSelectedPin}
        onCenterChange={selectArea}
        eventType={edition.type}
      />
      <div className="card" style={{ margin: "0.75rem", borderRadius: "var(--radius)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <strong>{neighborhood?.name ?? (eventError ? "Choose a supported holiday" : loaded ? "No neighborhoods near this point" : "Loading neighborhood…")}</strong>
          <button className="btn btn--secondary" onClick={onShare} disabled={!neighborhood} style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}>
            {shareCopied ? "Copied!" : "Share"}
          </button>
        </div>
        {error && <p role="alert" className="muted">{error}</p>}
        {neighborhood && <Link to={`/dashboard?eventId=${encodeURIComponent(eventId)}&neighborhood=${encodeURIComponent(neighborhood.id)}&lat=${lookupPoint.lat}&lon=${lookupPoint.lon}`}>Associate my house with {neighborhood.name}</Link>}
        {loaded && !neighborhood && !error && <p className="muted">Search your address or use your location, then add your neighborhood to get started.</p>}
        {selectedPin && pins.find((pin) => pin.id === selectedPin) && <p role="status">
          Selected house: {EVENT_STATUS_LABELS[pins.find((pin) => pin.id === selectedPin)!.status]}
        </p>}
        <p className="muted">
          {pins.length} house{pins.length === 1 ? "" : "s"} opted in · refreshed {formatRelativeTime(lastRefreshed.toISOString())}
        </p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {pins.map((pin) => (
            <li key={pin.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className={`pill pill--${pin.status}`}>{EVENT_STATUS_LABELS[pin.status]}</span>
              <span className="muted">{formatRelativeTime(pin.updatedAt)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
