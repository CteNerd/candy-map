import { NavLink, Route, Routes } from "react-router-dom";
import { NeighborhoodMapScreen } from "./screens/NeighborhoodMapScreen";
import { FindJoinNeighborhoodScreen } from "./screens/FindJoinNeighborhoodScreen";
import { ResidentDashboard } from "./screens/ResidentDashboard";
import { OrganizerDashboard } from "./screens/OrganizerDashboard";
import { AuthCallbackScreen } from "./screens/AuthCallbackScreen";
import { AuthProvider } from "./auth/AuthContext";
import { CreateNeighborhoodScreen } from "./screens/CreateNeighborhoodScreen";

function App() {
  return (
    <AuthProvider>
      <div className="app-shell">
        <header className="app-header">
          <h1>🎃 Candy Map</h1>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<NeighborhoodMapScreen />} />
            <Route path="/join" element={<FindJoinNeighborhoodScreen />} />
            <Route path="/neighborhoods/new" element={<CreateNeighborhoodScreen />} />
            <Route path="/dashboard" element={<ResidentDashboard />} />
            <Route path="/organizer" element={<OrganizerDashboard />} />
            <Route path="/auth/callback" element={<AuthCallbackScreen />} />
          </Routes>
        </main>
        <nav className="app-nav">
          <NavLink to="/" end>
            Map
          </NavLink>
          <NavLink to="/join">Find/Join</NavLink>
          <NavLink to="/dashboard">Resident</NavLink>
          <NavLink to="/organizer">Organizer</NavLink>
        </nav>
      </div>
    </AuthProvider>
  );
}

export default App;
