import { useEffect, useState, type FormEvent } from "react";
import { isPointInPolygon, type CandyStatus, type HouseClaim } from "@candy-map/shared";
import { useAuth } from "../auth/AuthContext";
import { fetchMyClaims, fetchNeighborhoodsNear, isLiveApiConfigured, resolveHouse, submitClaim, toggleCandyStatus } from "../lib/api";
import { SEED_NEIGHBORHOOD } from "../lib/fixtures";

const STATUS_OPTIONS: CandyStatus[] = ["available", "low", "finished"];

export function ResidentDashboard() {
  const { user, isConfigured, signIn, signOut } = useAuth();
  const [claim, setClaim] = useState<HouseClaim | null>(null);
  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [lat, setLat] = useState(String(SEED_NEIGHBORHOOD.centroid.lat));
  const [lon, setLon] = useState(String(SEED_NEIGHBORHOOD.centroid.lon));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !isLiveApiConfigured()) return;
    fetchMyClaims()
      .then((claims) => {
        const mine = claims[0];
        if (mine) setClaim(mine);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not restore your claims."));
  }, [user]);

  if (!isConfigured) {
    return (
      <div className="screen">
        <h2>Resident dashboard</h2>
        <div className="banner">
          Sign-in isn't configured yet. Deploy the CDK stack, then set{" "}
          <code>VITE_COGNITO_DOMAIN</code> and <code>VITE_COGNITO_CLIENT_ID</code> for the web app
          (see README "Environment variables").
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="screen">
        <h2>Resident dashboard</h2>
        <p className="muted">Sign in to claim your house and update its candy status.</p>
        <button className="btn" onClick={signIn}>
          Sign in
        </button>
      </div>
    );
  }

  async function onSubmitAddress(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const point = { lat: Number(lat), lon: Number(lon) };
      if (!lat.trim() || !lon.trim() || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
        throw new Error("Enter valid latitude and longitude.");
      }
      const neighborhoods = await fetchNeighborhoodsNear(point.lat, point.lon);
      const neighborhood = neighborhoods.find((candidate) => isPointInPolygon(point, candidate.polygon));
      if (!neighborhood) throw new Error("No neighborhood contains this point. Ask an organizer to create one first.");
      const { house: resolvedHouse } = await resolveHouse({
        neighborhoodId: neighborhood.id,
        street,
        unit: unit || undefined,
        postalCode,
        country: "us",
        point,
      });
      const newClaim = await submitClaim(resolvedHouse.id);
      setClaim(newClaim);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onToggleStatus(status: CandyStatus) {
    if (!claim) {
      setError("No house claim is selected.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await toggleCandyStatus(claim.houseId, { status, publicOptIn: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h2>Resident dashboard</h2>
      <p className="muted">
        Signed in as {user.email ?? user.sub}.{" "}
        <button className="btn btn--secondary" onClick={signOut} style={{ padding: "0.2rem 0.6rem" }}>
          Sign out
        </button>
      </p>

      {error && <p className="muted">⚠️ {error}</p>}

      {!claim && (
        <form className="card" onSubmit={onSubmitAddress} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <p className="muted">
            No real geocoder is wired up yet (mock adapter) — enter your address and confirm the
            point falls inside the neighborhood boundary.
          </p>
          <div className="field">
            <label htmlFor="street">Street address</label>
            <input id="street" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="123 Example St" required />
          </div>
          <div className="field">
            <label htmlFor="unit">Unit (optional)</label>
            <input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="postalCode">Postal code</label>
            <input id="postalCode" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="resident-lat">Latitude</label>
            <input id="resident-lat" value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="resident-lon">Longitude</label>
            <input id="resident-lon" value={lon} onChange={(e) => setLon(e.target.value)} />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Claim this house
          </button>
        </form>
      )}

      {claim && claim.status !== "approved" && (
        <div className="card">
          <span className={`pill pill--${claim.status === "disputed" ? "low" : "available"}`}>
            {claim.status === "disputed" ? "Disputed — awaiting organizer review" : "Pending organizer approval"}
          </span>
          <p className="muted">
            Your claim was submitted as <code>self_reported</code>. You can update the candy
            status once an organizer approves it.
          </p>
        </div>
      )}

      {claim && claim.status === "approved" && (
        <div className="card">
          <strong>Candy status</strong>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            {STATUS_OPTIONS.map((status) => (
              <button key={status} className="btn btn--secondary" disabled={busy} onClick={() => onToggleStatus(status)}>
                {status}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
