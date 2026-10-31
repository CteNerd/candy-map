import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { approveClaim } from "../lib/api";
import { Link, useSearchParams } from "react-router-dom";

/**
 * Organizer claim approval is wired to the real `POST /admin/claims/{id}/approve` endpoint.
 *
 * Known gap: COPILOT_PLAN.md's API contract has no "list pending claims for a neighborhood"
 * endpoint, so there's no backend to list *which* claims need review yet — an organizer currently
 * needs the claim id (`<houseId>::<claimantUserId>`) out of band. Adding a proper review queue
 * endpoint is tracked in TASKS.md Milestone 4 alongside the duplicate-neighborhood review queue.
 */
export function OrganizerDashboard() {
  const { user, isConfigured, signIn } = useAuth();
  const [params] = useSearchParams();
  const [claimId, setClaimId] = useState(params.get("claim") ?? "");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isConfigured) {
    return (
      <div className="screen">
        <h2>Organizer dashboard</h2>
        <Link className="btn" to="/neighborhoods/new">Add neighborhood</Link>
        <div className="banner">Sign-in isn't configured yet — see README "Environment variables".</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="screen">
        <h2>Organizer dashboard</h2>
        <button className="btn" onClick={signIn}>
          Sign in
        </button>
      </div>
    );
  }

  async function onApprove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const approved = await approveClaim(claimId);
      setResult(`Approved claim for house ${approved.houseId} (claimant ${approved.userId}).`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h2>Organizer dashboard</h2>
      <div className="banner">
        Duplicate-neighborhood overlap review and community-report moderation ship in Milestone 4.
      </div>
      <form className="card" onSubmit={onApprove} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <strong>Approve a claim</strong>
        <div className="field">
          <label htmlFor="claimId">Claim id (houseId::claimantUserId)</label>
          <input id="claimId" value={claimId} onChange={(e) => setClaimId(e.target.value)} required />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          Approve
        </button>
        {result && <p className="muted">{result}</p>}
        {error && <p className="muted">⚠️ {error}</p>}
      </form>
    </div>
  );
}
