import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useEventEdition } from "../lib/useEventEdition";

export function HomeScreen() {
  const { eventId, edition } = useEventEdition();
  const { user, isConfigured, signIn } = useAuth();
  const eventQuery = `?eventId=${encodeURIComponent(eventId)}`;

  return (
    <div className="screen">
      <img
        src="/share-card.png"
        alt="Neighborhood Celebrations"
        style={{ width: "100%", maxHeight: "280px", objectFit: "cover", borderRadius: "var(--radius)" }}
      />
      <p className="event-summary"><strong>{edition.icon} {edition.label}</strong> · Neighborhood Celebrations</p>
      <h2>Make local celebrations feel closer</h2>
      <p>
        Find neighbors who have chosen to participate in each holiday. Halloween and Christmas
        listings are separate: opt in, set your status, and choose public visibility for each
        event independently.
      </p>
      <div className="button-row">
        <Link className="btn" to={`/map${eventQuery}`}>Explore the map</Link>
        <Link className="btn btn--secondary" to={`/dashboard${eventQuery}`}>Manage my home</Link>
        <Link className="btn btn--secondary" to="/privacy">Privacy and removal</Link>
      </div>
      <section className="card">
        <h3>Participation is always your choice</h3>
        <p>
          A precise location can reveal where someone lives and when a home may be active. Only
          publish a home you have the right to represent, and share no more than you are comfortable
          making visible on a public map.
        </p>
        <p>
          If you share a home, coordinate with the other residents and invite them to manage their
          own participation. A unit-level request or invitation does not grant rights over an
          entire building.
        </p>
      </section>
      <section className="card">
        <h3>One house, more than one helper</h3>
        <p>
          Invite someone with a share link or email to help manage one house, for one holiday
          or across editions. Sharing your home never shares access to your other properties.
          Community sightings and joint displays are not enabled yet.
        </p>
        {!user && isConfigured && <button className="btn" onClick={signIn}>Sign in</button>}
        {user && <p className="muted">You are signed in and can manage your own event participation.</p>}
      </section>
    </div>
  );
}
