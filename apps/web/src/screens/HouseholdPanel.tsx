import { useState } from "react";
import { createHouseInvitation, fetchHousehold, householdAction, type HouseholdDetails } from "../lib/api";
import { getEventEdition } from "@candy-map/shared";

export function HouseholdPanel({ houseId, eventId }: { houseId: string; eventId: string }) {
  const [role, setRole] = useState<"manager" | "editor">("editor");
  const [allEditions, setAllEditions] = useState(false);
  const [email, setEmail] = useState("");
  const [invitation, setInvitation] = useState<{ link: string; expiresAt: string; emailAccepted: boolean } | null>(null);
  const [household, setHousehold] = useState<HouseholdDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setBusy(true); setError(null);
    try { setHousehold(await fetchHousehold(houseId, eventId)); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not load house members."); }
    finally { setBusy(false); }
  }
  async function invite(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setInvitation(null); setMessage(null);
    try {
      setInvitation(await createHouseInvitation(houseId, {
        role, ...(!allEditions ? { eventId } : {}), ...(email.trim() ? { email: email.trim() } : {}),
      }));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not create the invitation."); }
    finally { setBusy(false); }
  }
  async function action(key: string, action: string) {
    setBusy(true); setError(null);
    try {
      await householdAction(houseId, { key, action, eventId });
      setHousehold(await fetchHousehold(houseId, eventId));
      setMessage("Household changes saved.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save household changes."); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!invitation) return;
    try { await navigator.clipboard.writeText(invitation.link); setMessage("Invitation link copied."); }
    catch { setError("Could not copy the invitation. Select and copy the link below."); }
  }
  return <section className="card">
    <h3>Invite someone to help</h3>
    <p className="muted">Access applies only to this house. Editors update saved activity details but cannot change publication permission. Managers can invite others and manage applicable publication choices. An invitation is not proof of residency.</p>
    <form onSubmit={invite} className="form-stack">
      <div className="field"><label htmlFor="helper-role">Helper role</label>
        <select id="helper-role" value={role} disabled={busy} onChange={(event) => {
          if (event.target.value === "manager" || event.target.value === "editor") setRole(event.target.value);
        }}><option value="editor">Editor</option><option value="manager">Manager</option></select></div>
      <label><input type="checkbox" checked={allEditions} disabled={busy} onChange={(event) => setAllEditions(event.target.checked)} /> Allow access across this house's holiday editions (does not enroll the house)</label>
      <div className="field"><label htmlFor="helper-email">Recipient email (optional)</label>
        <input id="helper-email" type="email" maxLength={254} disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <p className="muted">Leave email blank for a share-only link. Email invitations must be accepted using that verified email account. Links expire after 48 hours.</p>
      <button className="btn" disabled={busy}>{busy ? "Working..." : "Create invitation"}</button>
    </form>
    {invitation && <div className="form-stack">
      <p role="status">{invitation.emailAccepted ? "Invitation email accepted for sending. Inbox delivery is not guaranteed." : "Share-link invitation created."} Expires {new Date(invitation.expiresAt).toLocaleString()}.</p>
      <label className="field">Private invitation link<input readOnly value={invitation.link} /></label>
      <button className="btn btn--secondary" onClick={copy}>Copy invitation link</button>
      <p className="muted">Do not post this access link publicly.</p>
    </div>}
    <h3>Members and access requests</h3>
    <button className="btn btn--secondary" disabled={busy} onClick={load}>Load house members</button>
    {household && <>
      <ul>{household.members.map((member) => <li key={member.key}>{member.label} · {member.role}
        {member.eventId && ` · ${getEventEdition(member.eventId)?.label ?? "Holiday-restricted"}`}
        {member.removable && <button className="btn btn--secondary" disabled={busy} onClick={() => action(member.key, "remove-member")}>Remove helper</button>}
      </li>)}</ul>
      {household.requests.length === 0 && <p className="muted">No pending access requests.</p>}
      {household.requests.map((request) => <div key={request.key} className="button-row">{request.label}
        <button className="btn" disabled={busy} onClick={() => action(request.key, "approve-request")}>Allow editor access for this holiday</button>
        <button className="btn btn--secondary" disabled={busy} onClick={() => action(request.key, "reject-request")}>Decline</button>
      </div>)}
      {household.invitations.map((entry) => <div key={entry.key} className="button-row">{entry.label} · {entry.role}
        <button className="btn btn--secondary" disabled={busy} onClick={() => action(entry.key, "revoke-invite")}>Revoke invitation</button>
      </div>)}
      <p className="muted">To share management, invite another manager and have them accept. You cannot remove yourself or an approved claim here. Disputed property authority requires private review; do not upload identity documents.</p>
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
