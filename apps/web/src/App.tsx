import { NavLink, Route, Routes, useSearchParams } from "react-router-dom";
import { getEventCatalog, getEventLifecycle } from "@candy-map/shared";
import { useEventEdition } from "./lib/useEventEdition";
import { NeighborhoodMapScreen } from "./screens/NeighborhoodMapScreen";
import { FindJoinNeighborhoodScreen } from "./screens/FindJoinNeighborhoodScreen";
import { ResidentDashboard } from "./screens/ResidentDashboard";
import { OrganizerDashboard } from "./screens/OrganizerDashboard";
import { AuthCallbackScreen } from "./screens/AuthCallbackScreen";
import { AuthProvider } from "./auth/AuthContext";
import { CreateNeighborhoodScreen } from "./screens/CreateNeighborhoodScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { PrivacyScreen } from "./screens/PrivacyScreen";
import { InviteScreen } from "./screens/InviteScreen";

function App() {
  const { edition, eventId, eventError } = useEventEdition();
  const [params, setParams] = useSearchParams();
  const catalog = getEventCatalog();
  if (!catalog.some((item) => item.id === edition.id)) catalog.push(edition);
  const eventQuery = `?eventId=${encodeURIComponent(eventId)}`;
  return (
    <AuthProvider>
      <div className="app-shell" data-event={edition.type}>
        <header className="app-header">
          <h1><span aria-hidden="true">{edition.icon}</span> Neighborhood Celebrations</h1>
          <div className="field event-selector">
            <label htmlFor="event-edition">Holiday</label>
            <select id="event-edition" value={eventId} onChange={(event) => {
              const next = new URLSearchParams(params);
              next.set("eventId", event.target.value);
              setParams(next);
            }}>
              {eventError && <option value={eventId}>Unsupported edition</option>}
              {(["active", "upcoming", "past"] as const).map((lifecycle) => (
                <optgroup key={lifecycle} label={lifecycle[0].toUpperCase() + lifecycle.slice(1)}>
                  {catalog.filter((item) => getEventLifecycle(item) === lifecycle).map((item) =>
                    <option key={item.id} value={item.id}>{item.icon} {item.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={params.has("lat") || params.has("neighborhood") ? <NeighborhoodMapScreen /> : <HomeScreen />} />
            <Route path="/map" element={<NeighborhoodMapScreen />} />
            <Route path="/privacy" element={<PrivacyScreen />} />
            <Route path="/invite" element={<InviteScreen />} />
            <Route path="/join" element={<FindJoinNeighborhoodScreen />} />
            <Route path="/neighborhoods/new" element={<CreateNeighborhoodScreen />} />
            <Route path="/dashboard" element={<ResidentDashboard />} />
            <Route path="/organizer" element={<OrganizerDashboard />} />
            <Route path="/auth/callback" element={<AuthCallbackScreen />} />
          </Routes>
        </main>
        <nav className="app-nav">
          <NavLink to={`/${eventQuery}`} end>Home</NavLink>
          <NavLink to={`/map${eventQuery}`}>
            Map
          </NavLink>
          <NavLink to={`/join${eventQuery}`}>Find/Join</NavLink>
          <NavLink to={`/dashboard${eventQuery}`}>My houses</NavLink>
          <NavLink to={`/organizer${eventQuery}`}>Organizer</NavLink>
          <NavLink to="/privacy">Privacy</NavLink>
        </nav>
      </div>
    </AuthProvider>
  );
}

export default App;
