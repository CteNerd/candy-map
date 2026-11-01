import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const auth = vi.hoisted(() => ({ user: { sub: "manager" } as { sub: string } | null, signIn: vi.fn() }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ ...auth, isConfigured: true }) }));
vi.mock("../src/lib/api", () => ({
  createHouseInvitation: vi.fn(), fetchHousehold: vi.fn(), householdAction: vi.fn(), acceptHouseInvitation: vi.fn(),
  fetchMyNeighborhoods: vi.fn(), fetchNeighborhoodClaims: vi.fn(), renameNeighborhood: vi.fn(), approveClaim: vi.fn(),
}));
import { createHouseInvitation, acceptHouseInvitation, fetchMyNeighborhoods, renameNeighborhood } from "../src/lib/api";
import { HouseholdPanel } from "../src/screens/HouseholdPanel";
import { InviteScreen } from "../src/screens/InviteScreen";
import { OrganizerDashboard } from "../src/screens/OrganizerDashboard";
afterEach(() => { cleanup(); vi.clearAllMocks(); auth.user = { sub: "manager" }; });
describe("household and organizer UX", () => {
  it("creates a holiday-scoped email invitation with a private copyable link", async () => {
    vi.mocked(createHouseInvitation).mockResolvedValue({ link: `https://example.com/invite#${"a".repeat(64)}`, expiresAt: "2026-12-03T00:00:00Z", emailAccepted: true, role: "editor" });
    render(<HouseholdPanel houseId="private-house-id" eventId="christmas-lights-2026" />);
    fireEvent.change(screen.getByLabelText("Recipient email (optional)"), { target: { value: "helper@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    await waitFor(() => expect(createHouseInvitation).toHaveBeenCalledWith("private-house-id", { role: "editor", eventId: "christmas-lights-2026", email: "helper@example.com" }));
    expect(await screen.findByText(/email accepted for sending/)).toBeInTheDocument();
    expect(screen.queryByText(/private-house-id/)).not.toBeInTheDocument();
  });
  it("keeps invitation errors visible without a success-shaped link", async () => {
    vi.mocked(createHouseInvitation).mockRejectedValue(new Error("Delivery failed"));
    render(<HouseholdPanel houseId="h1" eventId="christmas-lights-2026" />);
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Delivery failed");
    expect(screen.queryByLabelText("Private invitation link")).not.toBeInTheDocument();
  });
  it("preserves the fragment invitation until signed-in acceptance and displays the house name", async () => {
    vi.mocked(acceptHouseInvitation).mockResolvedValue({ houseLabel: "100 Example Street", role: "editor", eventId: "christmas-lights-2026" });
    const token = "a".repeat(64);
    render(<MemoryRouter initialEntries={[`/invite#${token}`]}><InviteScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Accept house invitation" }));
    expect(await screen.findByRole("status")).toHaveTextContent("100 Example Street");
    expect(acceptHouseInvitation).toHaveBeenCalledWith(token);
    expect(screen.getByRole("link", { name: "Open My houses" })).toHaveAttribute("href", "/dashboard?eventId=christmas-lights-2026");
  });
  it("requires sign-in rather than auto-accepting a household link", () => {
    auth.user = null;
    render(<MemoryRouter initialEntries={[`/invite#${"a".repeat(64)}`]}><InviteScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Sign in to review and accept" }));
    expect(auth.signIn).toHaveBeenCalled();
    expect(acceptHouseInvitation).not.toHaveBeenCalled();
  });
  it("edits a neighborhood name without exposing IDs or asking for claim IDs", async () => {
    const neighborhood = { id: "private-neighborhood-id", name: "Lakes of Example", normalizedName: "", polygon: { type: "Polygon" as const, coordinates: [] }, bbox: { minLat: 1, maxLat: 2, minLon: 1, maxLon: 2 }, centroid: { lat: 1, lon: 1 }, status: "active" as const };
    vi.mocked(fetchMyNeighborhoods).mockResolvedValue([neighborhood]);
    vi.mocked(renameNeighborhood).mockResolvedValue({ ...neighborhood, name: "Lakes of Example - North" });
    render(<MemoryRouter><OrganizerDashboard /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("Neighborhood name"), { target: { value: "Lakes of Example - North" } });
    fireEvent.click(screen.getByRole("button", { name: "Save neighborhood name" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Lakes of Example - North");
    expect(renameNeighborhood).toHaveBeenCalledWith("private-neighborhood-id", "Lakes of Example - North");
    expect(screen.queryByText(/private-neighborhood-id/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Claim id/)).not.toBeInTheDocument();
  });
});
