import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EVENT_STATUS_LABELS, isPointInPolygon, type EventParticipation, type EventStatus, type HouseClaim, type MyHouseClaim, type PublicNeighborhood } from "@candy-map/shared";
import { useAuth } from "../auth/AuthContext";
import { fetchMyClaims, fetchNeighborhoodsNear, isLiveApiConfigured, resolveHouse, submitClaim, updateEventParticipation } from "../lib/api";
import { GoogleMap } from "../map/GoogleMap";
import { AddressSearch } from "../map/AddressSearch";
import { DEFAULT_CENTER, parsePoint, useLocation } from "../map/useLocation";
import { useEventEdition } from "../lib/useEventEdition";

export function ResidentDashboard() {
  const { eventId } = useEventEdition();
  const { user } = useAuth();
  return <ResidentDashboardForEvent key={`${eventId}:${user?.sub ?? ""}`} />;
}

function ResidentDashboardForEvent() {
  const { edition, eventId, lifecycle, eventError } = useEventEdition();
  const { user, isConfigured, signIn, signOut } = useAuth();
  const [params, setParams] = useSearchParams();
  const [preferredHouseId] = useState(params.get("houseId"));
  const [claim, setClaim] = useState<HouseClaim | null>(null);
  const [claims, setClaims] = useState<MyHouseClaim[]>([]);
  const [addingHouse, setAddingHouse] = useState(false);
  const [participation, setParticipation] = useState<EventParticipation | null>(null);
  const [publicOptIn, setPublicOptIn] = useState(false);
  const [savingStatus, setSavingStatus] = useState<EventStatus | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const initialPoint = parsePoint(params.get("lat"), params.get("lon")) ?? DEFAULT_CENTER;
  const [lat, setLat] = useState(String(initialPoint.lat));
  const [lon, setLon] = useState(String(initialPoint.lon));
  const [country, setCountry] = useState("us");
  const [neighborhoodId, setNeighborhoodId] = useState(params.get("neighborhood") ?? "");
  const [neighborhoods, setNeighborhoods] = useState<PublicNeighborhood[]>([]);
  const [neighborhoodLoading, setNeighborhoodLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(() => Boolean(user && isLiveApiConfigured() && !eventError));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const point = useMemo(() => parsePoint(lat, lon), [lat, lon]);
  const selectedNeighborhood = neighborhoods.find((item) => item.id === neighborhoodId);
  const { location, locating, locationError, locate } = useLocation((value) => {
    setLat(String(value.lat)); setLon(String(value.lon)); setConfirmed(false);
  });

  useEffect(() => {
    if (!user || !isLiveApiConfigured() || eventError) return;
    let active = true;
    fetchMyClaims(eventId)
      .then((claims) => {
        if (active) {
          const mine = claims.find((item) => item.houseId === preferredHouseId)
            ?? claims.find((item) => item.status === "approved") ?? claims.find((item) => item.status !== "rejected");
          setClaims(claims);
          setClaim(mine ?? null);
          setParticipation(mine?.eventParticipation ?? null);
          setPublicOptIn(mine?.eventParticipation?.publicOptIn ?? false);
          setError(null);
        }
      })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Could not restore your claims."); })
      .finally(() => { if (active) setClaimLoading(false); });
    return () => { active = false; };
  }, [user, eventId, eventError, preferredHouseId]);

  useEffect(() => {
    if (!user || !point) return;
    let active = true;
    const timeout = setTimeout(() => {
      setNeighborhoodLoading(true);
      fetchNeighborhoodsNear(point.lat, point.lon).then((items) => {
        if (!active) return;
        setNeighborhoods(items);
        setNeighborhoodId((current) => items.some((item) => item.id === current)
          ? current : items.find((item) => isPointInPolygon(point, item.polygon))?.id || "");
      }).catch((err: unknown) => {
        if (active) {
          setNeighborhoods([]);
          setError(err instanceof Error ? err.message : "Could not load neighborhoods.");
        }
      }).finally(() => { if (active) setNeighborhoodLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timeout); };
  }, [user, point]);

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
        <p className="muted">Sign in to claim your house and manage its holiday participation.</p>
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
      if (!point) {
        throw new Error("Enter valid latitude and longitude.");
      }
      if (!confirmed) throw new Error("Confirm your address and house location before claiming.");
      const neighborhoods = await fetchNeighborhoodsNear(point.lat, point.lon);
      const neighborhood = neighborhoods.find((candidate) => candidate.id === neighborhoodId);
      if (!neighborhood) throw new Error("No neighborhood contains this point. Ask an organizer to create one first.");
      if (!isPointInPolygon(point, neighborhood.polygon)) throw new Error("Your house must be inside the selected neighborhood boundary.");
      const { house: resolvedHouse } = await resolveHouse({
        neighborhoodId: neighborhood.id,
        street,
        unit: unit || undefined,
        postalCode,
        country,
        point,
      });
      if (resolvedHouse.neighborhoodId !== neighborhood.id) {
        throw new Error("This address is already associated with a different neighborhood. Ask an organizer to review it.");
      }
      const newClaim = await submitClaim(resolvedHouse.id);
      setClaims((current) => [...current.filter((item) => item.houseId !== newClaim.houseId), { ...newClaim, participation: null, eventParticipation: null }]);
      setClaim(newClaim);
      setParticipation(null);
      setPublicOptIn(false);
      setAddingHouse(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim the house.");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleStatus(status: EventStatus) {
    if (!claim) {
      setError("No house claim is selected.");
      return;
    }
    setBusy(true);
    setError(null);
    setSavingStatus(status);
    setSaveMessage(null);
    try {
      const saved = await updateEventParticipation(claim.houseId, eventId, { status, publicOptIn });
      setParticipation(saved);
      setClaims((current) => current.map((item) => item.houseId === claim.houseId ? { ...item, eventParticipation: saved } : item));
      setSaveMessage(`Saved: ${EVENT_STATUS_LABELS[saved.status]}.${saved.publicOptIn ? "" : " Private — not on the public map."}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save holiday participation.");
    } finally {
      setBusy(false);
      setSavingStatus(null);
    }
  }

  return (
    <div className="screen">
      <h2>Resident dashboard</h2>
      <p className="event-summary">{edition.icon} {edition.label} · {lifecycle}</p>
      {eventError && <p role="alert" className="banner">{eventError}</p>}
      <p className="muted">
        Signed in as {user.email ?? user.sub}.{" "}
        <button className="btn btn--secondary" onClick={signOut} style={{ padding: "0.2rem 0.6rem" }}>
          Sign out
        </button>
      </p>

      {error && <p className="muted" role="alert">⚠️ {error}</p>}
      {claimLoading && <p role="status">Loading your house claims...</p>}
      {claims.length > 0 && !claimLoading && !eventError && <div className="field">
        <label htmlFor="my-house">My houses</label>
        <select id="my-house" value={claim?.houseId ?? ""} disabled={busy} onChange={(event) => {
          const selected = claims.find((item) => item.houseId === event.target.value);
          const next = new URLSearchParams(params);
          next.set("houseId", event.target.value);
          setParams(next, { replace: true });
          setClaim(selected ?? null);
          setParticipation(selected?.eventParticipation ?? null);
          setPublicOptIn(selected?.eventParticipation?.publicOptIn ?? false);
          setSaveMessage(null);
          setError(null);
          setAddingHouse(false);
        }}>
          {claims.map((item) => <option key={item.houseId} value={item.houseId}>House {item.houseId} · {item.status}</option>)}
        </select>
        <button className="btn btn--secondary" disabled={busy} onClick={() => setAddingHouse((value) => !value)}>{addingHouse ? "Cancel adding house" : "Add another house"}</button>
      </div>}

      {(!claim || addingHouse) && !claimLoading && !eventError && (
        <form className="card" onSubmit={onSubmitAddress} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <p className="muted">
            Search your house address, select its neighborhood, and confirm the marker. You can
            correct the point by tapping the map or entering coordinates. Address and location are self-reported, not proof of ownership.
          </p>
          {!isLiveApiConfigured() && <p className="banner">Fixture mode: configure the live API to save a house claim.</p>}
          <AddressSearch onSelect={(address) => {
            setStreet(address.street); setPostalCode(address.postalCode); setCountry(address.country || "us");
            setLat(String(address.point.lat)); setLon(String(address.point.lon)); setConfirmed(false);
          }} />
          <button className="btn btn--secondary" type="button" onClick={locate} disabled={locating}>{locating ? "Locating..." : "Use my location"}</button>
          {locationError && <p role="alert">{locationError}</p>}
          <div className="field">
            <label htmlFor="country">Country code</label>
            <input id="country" value={country} maxLength={2} required onChange={(event) => { setCountry(event.target.value.toLowerCase()); setConfirmed(false); }} />
          </div>
          <div className="field">
            <label htmlFor="resident-neighborhood">Neighborhood</label>
            <select id="resident-neighborhood" value={neighborhoodId} onChange={(event) => { setNeighborhoodId(event.target.value); setConfirmed(false); }} required>
              <option value="">Select your neighborhood</option>
              {neighborhoods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          {neighborhoodLoading && <p role="status">Finding neighborhoods...</p>}
          <Link to={`/neighborhoods/new?eventId=${encodeURIComponent(eventId)}`}>Add a neighborhood if yours is missing</Link>
          <GoogleMap center={point ?? initialPoint} pins={[]} selectedPoint={point ?? undefined}
            boundary={selectedNeighborhood?.polygon.coordinates[0]} userLocation={location}
            onMapClick={(value) => { setLat(String(value.lat)); setLon(String(value.lon)); setConfirmed(false); }}
            className="map-editor" eventType={edition.type} />
          <div className="field">
            <label htmlFor="street">Street address</label>
            <input id="street" value={street} onChange={(e) => { setStreet(e.target.value); setConfirmed(false); }} placeholder="123 Example St" required />
          </div>
          <div className="field">
            <label htmlFor="unit">Unit (optional)</label>
            <input id="unit" value={unit} onChange={(e) => { setUnit(e.target.value); setConfirmed(false); }} />
          </div>
          <div className="field">
            <label htmlFor="postalCode">Postal code</label>
            <input id="postalCode" value={postalCode} onChange={(e) => { setPostalCode(e.target.value); setConfirmed(false); }} required />
          </div>
          <div className="field">
            <label htmlFor="resident-lat">Latitude</label>
            <input id="resident-lat" value={lat} onChange={(e) => { setLat(e.target.value); setConfirmed(false); }} />
          </div>
          <div className="field">
            <label htmlFor="resident-lon">Longitude</label>
            <input id="resident-lon" value={lon} onChange={(e) => { setLon(e.target.value); setConfirmed(false); }} />
          </div>
          <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirm this address and marker identify my house inside the selected neighborhood.</label>
          <button className="btn" type="submit" disabled={busy || !confirmed || !point || !neighborhoodId || neighborhoodLoading || !isLiveApiConfigured()}>
            Claim this house
          </button>
        </form>
      )}

      {claim && claim.status !== "approved" && !addingHouse && !claimLoading && !eventError && (
        <div className="card">
          <span className={`pill pill--${claim.status === "disputed" ? "low" : "available"}`}>
            {claim.status === "disputed" ? "Disputed — awaiting organizer review" : "Pending organizer approval"}
          </span>
          <p className="muted">
            Your claim was submitted as <code>self_reported</code>. You can update holiday
            participation once an organizer approves it. Approval is not proof of ownership.
          </p>
          <Link to={`/organizer?eventId=${encodeURIComponent(eventId)}&claim=${encodeURIComponent(`${claim.houseId}::${claim.userId}`)}`}>Review this claim (organizers only)</Link>
        </div>
      )}

      {claim && claim.status === "approved" && !addingHouse && !claimLoading && !eventError && (
        <div className="card">
          <strong>{edition.type === "halloween" ? "Candy status" : "Christmas display"}</strong>
          <p className="muted">
            {participation ? `Last saved status: ${EVENT_STATUS_LABELS[participation.status]}.` : `No participation saved for ${edition.label}. Other holidays do not enroll this house.`}
          </p>
          {participation && <p className="muted">
            {participation.publicOptIn
              ? `Update expires: ${new Date(participation.expiresAt).toLocaleString()}. Finished, paused, and expired listings are hidden.`
              : "This saved status is private. Check publication permission and save a status to publish."}
          </p>}
          {lifecycle === "past" && <p className="banner">This holiday has ended. Your saved participation remains private here; public archives are not available yet.</p>}
          {edition.type === "christmas-lights" && <p className="muted">A display listing is not a live lights-on confirmation. Nightly viewing schedules are coming later.</p>}
          <label className="consent-field"><input type="checkbox" checked={publicOptIn} disabled={busy || lifecycle === "past"}
            onChange={(event) => setPublicOptIn(event.target.checked)} /> Publish this house's precise map location for {edition.label} when the event and status are active. This does not permit public historical pins.</label>
          {lifecycle !== "past" && <p className="muted">Choose a status below to save this publication preference. Changing the checkbox alone does not update the public map.</p>}
          <div className="button-row">
            {edition.statuses.map((status) => (
              <button key={status}
                className={`btn btn--secondary${participation?.status === status ? ` candy-status--${status}` : ""}`}
                aria-pressed={participation?.status === status} disabled={busy || lifecycle === "past"} onClick={() => onToggleStatus(status)}>
                {savingStatus === status ? "Saving..." : EVENT_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
          {saveMessage && <p role="status">{saveMessage}</p>}
        </div>
      )}
    </div>
  );
}
