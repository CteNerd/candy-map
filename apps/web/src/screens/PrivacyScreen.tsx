import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { submitPrivacyRequest, fetchPrivacyRequests, resolvePrivacyRequest, type PrivacyRequestEntry } from "../lib/api";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function PrivacyScreen() {
  const { user } = useAuth();
  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");
  const [mode, setMode] = useState<"block" | "remove">("block");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [queue, setQueue] = useState<PrivacyRequestEntry[] | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [authorityConfirmed, setAuthorityConfirmed] = useState<Record<string, boolean>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setRequestError(null);
    setSuccess(false);
    try {
      await submitPrivacyRequest({
        street: street.trim(),
        ...(unit.trim() ? { unit: unit.trim() } : {}),
        postalCode: postalCode.trim(),
        country: country.trim(),
        mode,
        ...(message.trim() ? { message: message.trim() } : {}),
      });
      setSuccess(true);
      setStreet("");
      setUnit("");
      setPostalCode("");
      setCountry("US");
      setMessage("");
    } catch (error) {
      setRequestError(getErrorMessage(error, "Could not submit the request. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function loadQueue() {
    setLoadingQueue(true);
    setQueueError(null);
    try {
      setQueue(await fetchPrivacyRequests());
    } catch (error) {
      setQueue(null);
      const message = getErrorMessage(error, "Could not load the privacy review queue.");
      setQueueError(
        /403|forbidden|not authorized|unauthorized/i.test(message)
          ? "You are not authorized to review privacy requests. Reviewer access is restricted."
          : message,
      );
    } finally {
      setLoadingQueue(false);
    }
  }

  async function resolve(requestId: string, decision: "approve" | "reject" | "restore") {
    setResolvingId(requestId);
    setQueueError(null);
    try {
      await resolvePrivacyRequest(requestId, {
        decision,
        note: reviewNotes[requestId]?.trim() ?? "",
        ...(decision === "restore" ? { authorityConfirmed: authorityConfirmed[requestId] === true } : {}),
      });
      setQueue((current) => current?.filter((request) => request.id !== requestId) ?? null);
    } catch (error) {
      setQueueError(getErrorMessage(error, "Could not resolve this request. Please try again."));
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="screen">
      <h2>Privacy and property removal</h2>
      <p>
        Anyone can ask us to keep a listing hidden or unpublish it, with or without signing in.
        You do not need to upload identity documents.
      </p>
      <div className="banner" role="note">
        Requests hide matching listings immediately. Open maps may take up to 30 seconds to refresh.
        Permanent or preemptive blocking requires reviewer approval. Requests apply to the specified
        unit, not an                 entire building. Resolved request details expire after 90 days and are deleted asynchronously; minimal blocks persist until reviewed restoration.
      </div>

      <form className="card" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <h3>Request a listing privacy change</h3>
        <div className="field">
          <label htmlFor="privacy-street">Street address</label>
          <input id="privacy-street" autoComplete="address-line1" value={street} onChange={(event) => setStreet(event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="privacy-unit">Unit (optional)</label>
          <input id="privacy-unit" autoComplete="address-line2" value={unit} onChange={(event) => setUnit(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="privacy-postal">Postal code</label>
          <input id="privacy-postal" autoComplete="postal-code" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="privacy-country">Country code</label>
          <input id="privacy-country" autoComplete="country" maxLength={2} value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} required />
        </div>
        <div className="field">
          <label htmlFor="privacy-mode">Request type</label>
          <select id="privacy-mode" value={mode} onChange={(event) => setMode(event.target.value as "block" | "remove")}>
            <option value="block">Block future publication (review required)</option>
            <option value="remove">Unpublish a current listing</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="privacy-message">Additional details (optional, 1,000 characters maximum)</label>
          <textarea id="privacy-message" maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} rows={4} />
        </div>
        <p className="muted">Please do not include sensitive information or identity documents.</p>
        <button className="btn" type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Submit privacy request"}</button>
        {requestError && <p className="muted" role="alert">{requestError}</p>}
        {success && <p className="muted" role="status">Your request was received. If review is needed, it will be handled by our privacy team.</p>}
      </form>

      {user && (
        <section className="card" aria-labelledby="privacy-review-heading">
          <h3 id="privacy-review-heading">Private reviewer area</h3>
          <p>Only members of the privacy-reviewer group are authorized by the server to access this queue.</p>
          <p className="muted">Before approving or restoring: verify property or unit authority through a trusted private contact, check conflicting household claims, and record the review outcome without identity documents or unnecessary personal details. Organizer approval, email access, and knowing an address alone do not verify residency.</p>
          <button className="btn btn--secondary" type="button" onClick={loadQueue} disabled={loadingQueue}>
            {loadingQueue ? "Loading..." : "Load review queue"}
          </button>
          {queueError && <p role="alert">{queueError}</p>}
          {queue && (
            <div>
              {queue.length === 0 && <p className="muted">No requests are waiting for review.</p>}
              {queue.map((request) => (
                <article key={request.id} className="card">
                  <h4>{request.address}</h4>
                  <p><strong>Type:</strong> {request.mode === "block" ? "Block future publication" : "Unpublish current listing"}</p>
                  <p><strong>State:</strong> {request.state}</p>
                  <p><strong>Submitted:</strong> {request.createdAt}</p>
                  {request.message && <p><strong>Message:</strong> {request.message}</p>}
                  <div className="field">
                    <label htmlFor={`review-note-${request.id}`}>Reviewer note</label>
                    <textarea
                      id={`review-note-${request.id}`}
                      maxLength={1000}
                      value={reviewNotes[request.id] ?? ""}
                      onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                      rows={3}
                    />
                  </div>
                  <div className="button-row">
                    <button className="btn" type="button" disabled={resolvingId !== null || request.state !== "pending" || !reviewNotes[request.id]?.trim()} onClick={() => void resolve(request.id, "approve")}>
                      {resolvingId === request.id ? "Saving..." : "Approve"}
                    </button>
                    <button className="btn btn--secondary" type="button" disabled={resolvingId !== null || request.state !== "pending" || !reviewNotes[request.id]?.trim()} onClick={() => void resolve(request.id, "reject")}>
                      Reject
                    </button>
                  </div>
                  {request.state !== "restored" && <>
                    <label><input type="checkbox" checked={authorityConfirmed[request.id] ?? false} onChange={(event) => setAuthorityConfirmed((current) => ({ ...current, [request.id]: event.target.checked }))} /> I have reviewed property authority, conflicting requests, and any appeal before releasing the hold.</label>
                    <button className="btn btn--secondary" disabled={resolvingId !== null || !authorityConfirmed[request.id] || !reviewNotes[request.id]?.trim()} onClick={() => void resolve(request.id, "restore")}>Release privacy hold after review</button>
                  </>}
                </article>
              ))}
              <p className="muted">Rejecting a request also keeps the listing hidden while the requester may appeal.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
