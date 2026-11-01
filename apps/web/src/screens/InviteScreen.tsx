import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { acceptHouseInvitation } from "../lib/api";

export function InviteScreen() {
  const { user, signIn } = useAuth();
  const location = useLocation();
  const token = location.hash.slice(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ houseLabel: string; role: string; eventId?: string } | null>(null);
  async function accept() {
    setBusy(true); setError(null);
    try {
      setResult(await acceptHouseInvitation(token));
      history.replaceState(null, "", location.pathname + location.search);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not accept this invitation."); }
    finally { setBusy(false); }
  }
  return <div className="screen">
    <h2>Household invitation</h2>
    <p>Accepting adds access to one house only. It does not claim residency, enroll another property, or publish a location. Email invitations require sign-in with the recipient's verified email.</p>
    {!/^[a-f0-9]{64}$/.test(token) && !result ? <p role="alert">This invitation link is missing or invalid. Ask the manager for a new link.</p> : !result && (
      user ? <button className="btn" disabled={busy} onClick={accept}>{busy ? "Accepting..." : "Accept house invitation"}</button>
        : <button className="btn" onClick={signIn}>Sign in to review and accept</button>
    )}
    {result && <div className="card"><p role="status">You can now help with {result.houseLabel} as a {result.role}.</p>
      <Link className="btn" to={`/dashboard${result.eventId ? `?eventId=${encodeURIComponent(result.eventId)}` : ""}`}>Open My houses</Link></div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
