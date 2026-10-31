import { useState, type FormEvent } from "react";
import type { Neighborhood } from "@candy-map/shared";
import { isPointInPolygon } from "@candy-map/shared";
import { fetchNeighborhoodsNear } from "../lib/api";

interface ResultRow {
  neighborhood: Neighborhood;
  contains: boolean;
}

export function FindJoinNeighborhoodScreen() {
  const [lat, setLat] = useState("37.7765");
  const [lon, setLon] = useState("-122.428");
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  async function search(searchLat: number, searchLon: number) {
    setLoading(true);
    try {
      const neighborhoods = await fetchNeighborhoodsNear(searchLat, searchLon);
      setResults(
        neighborhoods.map((neighborhood) => ({
          neighborhood,
          contains: isPointInPolygon({ lat: searchLat, lon: searchLon }, neighborhood.polygon),
        })),
      );
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedLat = Number.parseFloat(lat);
    const parsedLon = Number.parseFloat(lon);
    if (Number.isNaN(parsedLat) || Number.isNaN(parsedLon)) return;
    void search(parsedLat, parsedLon);
  }

  function useMyLocation() {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(String(position.coords.latitude));
        setLon(String(position.coords.longitude));
        void search(position.coords.latitude, position.coords.longitude);
      },
      () => setGeoError("Could not get your location — enter coordinates manually."),
    );
  }

  return (
    <div className="screen">
      <h2>Find or join a neighborhood</h2>
      <p className="muted">
        Enter a point (or use your location) to see which neighborhood contains it and any nearby
        ones. Address search will use Amazon Location Service / MapLibre place search in a later
        milestone — this POC accepts raw coordinates.
      </p>
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
          <button type="button" className="btn btn--secondary" onClick={useMyLocation}>
            Use my location
          </button>
        </div>
      </form>
      {geoError && <p className="muted">{geoError}</p>}
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
        </div>
      ))}
    </div>
  );
}
