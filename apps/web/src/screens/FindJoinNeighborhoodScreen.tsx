import { useState, type FormEvent } from "react";
import type { PublicNeighborhood } from "@candy-map/shared";
import { isPointInPolygon } from "@candy-map/shared";
import { fetchNeighborhoodsNear } from "../lib/api";
import { Link } from "react-router-dom";
import { AddressSearch } from "../map/AddressSearch";
import { parsePoint, useLocation } from "../map/useLocation";

interface ResultRow {
  neighborhood: PublicNeighborhood;
  contains: boolean;
}

export function FindJoinNeighborhoodScreen() {
  const [lat, setLat] = useState("37.7765");
  const [lon, setLon] = useState("-122.428");
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const { locating, locationError, locate } = useLocation((point) => {
    setLat(String(point.lat)); setLon(String(point.lon)); void search(point.lat, point.lon);
  });

  async function search(searchLat: number, searchLon: number) {
    setLoading(true);
    setGeoError(null);
    try {
      const neighborhoods = await fetchNeighborhoodsNear(searchLat, searchLon);
      setResults(
        neighborhoods.map((neighborhood) => ({
          neighborhood,
          contains: isPointInPolygon({ lat: searchLat, lon: searchLon }, neighborhood.polygon),
        })),
      );
    } catch (err) {
      setResults(null);
      setGeoError(err instanceof Error ? err.message : "Could not search neighborhoods.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const point = parsePoint(lat, lon);
    if (!point) {
      setGeoError("Enter valid latitude and longitude.");
      return;
    }
    void search(point.lat, point.lon);
  }

  return (
    <div className="screen">
      <h2>Find or join a neighborhood</h2>
      <p className="muted">
        Enter a point (or use your location) to see which neighborhood contains it and any nearby
        ones. Search an address, use your location, or enter coordinates.
      </p>
      <AddressSearch onSelect={({ point }) => {
        setLat(String(point.lat)); setLon(String(point.lon)); void search(point.lat, point.lon);
      }} />
      <Link to="/neighborhoods/new">Add a neighborhood</Link>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div className="field">
          <label htmlFor="lat">Latitude</label>
          <input id="lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="lon">Longitude</label>
          <input id="lon" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" className="btn">
            Search
          </button>
          <button type="button" className="btn btn--secondary" onClick={locate} disabled={locating}>
            {locating ? "Locating..." : "Use my location"}
          </button>
        </div>
      </form>
      {(geoError || locationError) && <p className="muted" role="alert">{geoError || locationError}</p>}
      {loading && <p className="muted">Searching…</p>}
      {results && results.length === 0 && <p className="muted">No neighborhoods found near that point.</p>}
      {results?.map(({ neighborhood, contains }) => (
        <div className="card" key={neighborhood.id}>
          <strong>{neighborhood.name}</strong>{" "}
          <span className="pill" style={{ background: contains ? "#16a34a33" : "#34275733", color: contains ? "#4ade80" : "#b9aee0" }}>
            {contains ? "Contains this point" : "Nearby"}
          </span>
          <p className="muted">
            Residents inside this boundary can sign in and claim their house from the dashboard.
          </p>
          <Link to={`/?neighborhood=${encodeURIComponent(neighborhood.id)}&lat=${neighborhood.centroid.lat}&lon=${neighborhood.centroid.lon}`}>View map</Link>{" "}
          <Link to={`/dashboard?neighborhood=${encodeURIComponent(neighborhood.id)}&lat=${neighborhood.centroid.lat}&lon=${neighborhood.centroid.lon}`}>Associate my house</Link>
        </div>
      ))}
    </div>
  );
}
