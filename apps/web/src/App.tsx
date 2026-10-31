import { NavLink, Route, Routes } from "react-router-dom";
import { NeighborhoodMapScreen } from "./screens/NeighborhoodMapScreen";
import { FindJoinNeighborhoodScreen } from "./screens/FindJoinNeighborhoodScreen";
import { ResidentDashboard } from "./screens/ResidentDashboard";
import { OrganizerDashboard } from "./screens/OrganizerDashboard";

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>🎃 Candy Map</h1>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<NeighborhoodMapScreen />} />
          <Route path="/join" element={<FindJoinNeighborhoodScreen />} />
          <Route path="/dashboard" element={<ResidentDashboard />} />
          <Route path="/organizer" element={<OrganizerDashboard />} />
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
  );
}

export default App;
