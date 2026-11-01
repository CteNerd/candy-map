import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { PublicNeighborhood } from "@candy-map/shared";
import { useAuth } from "../auth/AuthContext";
import { approveClaim, fetchMyNeighborhoods, fetchNeighborhoodClaims, renameNeighborhood, type OrganizerClaim } from "../lib/api";
import { useEventEdition } from "../lib/useEventEdition";

export function OrganizerDashboard() {
  const { user } = useAuth();
  return <OrganizerDashboardForAccount key={user?.sub ?? "signed-out"} />;
}

function OrganizerDashboardForAccount() {
  const { user, isConfigured, signIn } = useAuth();
  const { eventId } = useEventEdition();
  const [neighborhoods, setNeighborhoods] = useState<PublicNeighborhood[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [claims, setClaims] = useState<OrganizerClaim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(user));
  useEffect(() => {
    if (!user) return;
    let active = true;
    fetchMyNeighborhoods().then((items) => {
      if (active) { setNeighborhoods(items); setSelected(items[0]?.id ?? ""); setName(items[0]?.name ?? ""); }
    }).catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "Could not load your neighborhoods."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    try {
      const updated = await renameNeighborhood(selected, name.trim());
      setNeighborhoods((items) => items.map((item) => item.id === selected ? updated : item));
      setName(updated.name); setMessage(`Neighborhood renamed to ${updated.name}.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not rename neighborhood."); }
    finally { setBusy(false); }
  }
  async function loadClaims() {
    setBusy(true); setError(null);
    try { setClaims(await fetchNeighborhoodClaims(selected)); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not load pending claims."); }
    finally { setBusy(false); }
  }
  async function approve(claim: OrganizerClaim) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await approveClaim(claim.claimKey);
      setClaims((items) => items.filter((item) => item.claimKey !== claim.claimKey));
      setMessage(`Approved the claim for ${claim.houseLabel}.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not approve claim."); }
    finally { setBusy(false); }
  }
  if (!isConfigured) return <div className="screen"><h2>Organizer dashboard</h2><p className="banner">Sign-in is not configured.</p></div>;
  if (!user) return <div className="screen"><h2>Organizer dashboard</h2><button className="btn" onClick={signIn}>Sign in</button></div>;
  return <div className="screen">
    <h2>Organizer dashboard</h2>
    <div className="button-row">
      <Link className="btn" to={`/neighborhoods/new?eventId=${encodeURIComponent(eventId)}`}>Add neighborhood</Link>
      <Link className="btn btn--secondary" to="/privacy">Private privacy review</Link>
    </div>
    {loading && <p role="status">Loading your neighborhoods...</p>}
    {!loading && !neighborhoods.length && !error && <p>You do not organize any neighborhoods yet.</p>}
    {!loading && neighborhoods.length > 0 && <>
      <div className="field"><label htmlFor="organizer-neighborhood">Your neighborhood</label>
        <select id="organizer-neighborhood" value={selected} disabled={busy} onChange={(event) => {
          setSelected(event.target.value); setName(neighborhoods.find((item) => item.id === event.target.value)?.name ?? "");
          setClaims([]); setMessage(null);
        }}>{neighborhoods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <form className="card form-stack" onSubmit={save}>
        <h3>Edit neighborhood name</h3>
        <div className="field"><label htmlFor="edit-neighborhood-name">Neighborhood name</label>
          <input id="edit-neighborhood-name" value={name} maxLength={120} required disabled={busy} onChange={(event) => setName(event.target.value)} /></div>
        <p className="muted">Rename the existing neighborhood without changing its boundary, houses, claims, or memberships.</p>
        <button className="btn" disabled={busy || !name.trim()}>Save neighborhood name</button>
      </form>
      <section className="card"><h3>House claims</h3>
        <p className="muted">Addresses are private to authorized organizers. Approval is not proof of residency. Disputed claims need authority review; use household invitations for collaboration.</p>
        <button className="btn btn--secondary" disabled={busy} onClick={loadClaims}>Load pending claims</button>
        {claims.map((claim) => <article key={claim.claimKey} className="card">
          <h4>{claim.houseLabel}</h4><p>{claim.status === "disputed" ? "Disputed: another approved claim exists" : "Pending claim"}</p>
          {claim.status === "pending" ? <button className="btn" disabled={busy} onClick={() => approve(claim)}>Approve house claim</button>
            : <Link to="/privacy">Request private authority review</Link>}
        </article>)}
      </section>
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
