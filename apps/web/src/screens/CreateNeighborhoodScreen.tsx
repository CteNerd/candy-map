import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { validatePolygon, type GeoPoint, type Neighborhood, type PolygonGeoJSON } from "@candy-map/shared";
import { useAuth } from "../auth/AuthContext";
import { createNeighborhood, isLiveApiConfigured } from "../lib/api";
import { GoogleMap } from "../map/GoogleMap";
import { AddressSearch } from "../map/AddressSearch";
import { DEFAULT_CENTER, useLocation } from "../map/useLocation";

export function CreateNeighborhoodScreen() {
  const { user, isConfigured, signIn } = useAuth();
  const [name, setName] = useState("");
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [vertices, setVertices] = useState<GeoPoint[]>([]);
  const [created, setCreated] = useState<Neighborhood | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { location, locating, locationError, locate } = useLocation(setCenter);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const first = vertices[0];
    if (!first || vertices.length < 3) {
      setError("Choose at least three boundary corners on the map.");
      return;
    }
    const polygon: PolygonGeoJSON = {
      type: "Polygon",
      coordinates: [[...vertices.map(({ lat, lon }) => [lon, lat]), [first.lon, first.lat]]],
    };
    const validation = validatePolygon(polygon);
    if (!validation.valid) {
      setError(validation.errors.join(" "));
      return;
    }
    setBusy(true);
    try {
      setCreated(await createNeighborhood({ name: name.trim(), polygon }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the neighborhood.");
    } finally {
      setBusy(false);
    }
  }

  if (!isConfigured || !isLiveApiConfigured()) return <div className="screen">
    <h2>Add a neighborhood</h2>
    <p className="banner">Configure the live API and sign-in settings to save a neighborhood. Fixture mode does not save changes.</p>
  </div>;
  if (!user) return <div className="screen">
    <h2>Add a neighborhood</h2><p>Sign in to create a neighborhood and become its organizer.</p>
    <button className="btn" onClick={signIn}>Sign in</button>
  </div>;
  if (created) {
    const query = `neighborhood=${encodeURIComponent(created.id)}&lat=${created.centroid.lat}&lon=${created.centroid.lon}`;
    return <div className="screen">
      <h2>{created.name} created</h2>
      <p role="status">{created.status === "pending_review"
        ? "This neighborhood overlaps another area and is pending review. It will not appear on the public map until active."
        : "You are now this neighborhood's organizer."}</p>
      {created.status === "active" && <>
        <Link className="btn" to={`/dashboard?${query}`}>Associate my house</Link>
        <Link to={`/?${query}`}>View neighborhood map</Link>
      </>}
      {created.status !== "active" && <Link to="/organizer">Organizer dashboard</Link>}
    </div>;
  }
  return <div className="screen">
    <h2>Add a neighborhood</h2>
    <p className="muted">Find your area, then click or tap boundary corners in order around the neighborhood. Include your house. Use Undo to correct a corner; the outline closes automatically after three corners.</p>
    <AddressSearch onSelect={({ point }) => setCenter(point)} />
    <div className="button-row">
      <button className="btn" onClick={locate} disabled={locating}>{locating ? "Locating..." : "Use my location"}</button>
      <button className="btn btn--secondary" onClick={() => setVertices((points) => points.slice(0, -1))} disabled={busy || !vertices.length}>Undo corner</button>
      <button className="btn btn--secondary" onClick={() => setVertices([])} disabled={busy || !vertices.length}>Clear boundary</button>
    </div>
    {locationError && <p role="alert">{locationError}</p>}
    <GoogleMap center={center} pins={[]} draftPath={vertices} userLocation={location}
      onMapClick={busy ? undefined : (point) => setVertices((points) => [...points, point])} className="map-editor" />
    <p className="muted" role="status">{vertices.length} boundary corners selected</p>
    <form className="card" onSubmit={submit}>
      <div className="field"><label htmlFor="neighborhood-name">Neighborhood name</label>
        <input id="neighborhood-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} />
      </div>
      {error && <p role="alert">{error}</p>}
      <button className="btn" disabled={busy || vertices.length < 3 || !name.trim()}>{busy ? "Saving..." : "Create neighborhood"}</button>
    </form>
  </div>;
}
