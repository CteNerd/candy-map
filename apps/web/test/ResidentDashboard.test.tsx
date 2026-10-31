import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SEED_NEIGHBORHOOD } from "../src/lib/fixtures";

const useAuthMock = vi.fn();
const savedParticipation = {
  houseId: "restored-house", seasonId: "2026", status: "available" as const,
  publicOptIn: true, updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("../src/lib/api", () => ({
  fetchMyClaims: vi.fn().mockResolvedValue([]),
  isLiveApiConfigured: vi.fn().mockReturnValue(false),
  fetchNeighborhoodsNear: vi.fn().mockResolvedValue([]),
  resolveHouse: vi.fn(),
  submitClaim: vi.fn(),
  toggleCandyStatus: vi.fn(),
}));
vi.mock("../src/map/GoogleMap", () => ({ GoogleMap: () => <div data-testid="house-map" /> }));
vi.mock("../src/map/AddressSearch", () => ({ AddressSearch: () => <div /> }));

import { ResidentDashboard } from "../src/screens/ResidentDashboard";
import { fetchMyClaims, fetchNeighborhoodsNear, isLiveApiConfigured, resolveHouse, submitClaim, toggleCandyStatus } from "../src/lib/api";

function renderDashboard() {
  return render(<MemoryRouter><ResidentDashboard /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(isLiveApiConfigured).mockReturnValue(false);
});

describe("ResidentDashboard", () => {
  it("shows a setup message when Cognito isn't configured", () => {
    useAuthMock.mockReturnValue({ user: null, isConfigured: false, signIn: vi.fn(), signOut: vi.fn() });
    renderDashboard();
    expect(screen.getByText(/Sign-in isn't configured yet/)).toBeInTheDocument();
  });

  it("shows a sign-in button when configured but not authenticated", () => {
    const signIn = vi.fn();
    useAuthMock.mockReturnValue({ user: null, isConfigured: true, signIn, signOut: vi.fn() });
    renderDashboard();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows the claim form once signed in", () => {
    useAuthMock.mockReturnValue({
      user: { sub: "resident-1", email: "resident@example.com" },
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    renderDashboard();
    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
    expect(screen.getByText(/Signed in as resident@example.com/)).toBeInTheDocument();
  });

  it("toggles a restored approved claim without needing a resolved house object", async () => {
    useAuthMock.mockReturnValue({ user: { sub: "resident-1" }, isConfigured: true, signIn: vi.fn(), signOut: vi.fn() });
    vi.mocked(isLiveApiConfigured).mockReturnValue(true);
    vi.mocked(fetchMyClaims).mockResolvedValue([{
      houseId: "restored-house", userId: "resident-1", status: "approved",
      verificationLevel: "organizer_approved", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      participation: null,
    }]);
    vi.mocked(toggleCandyStatus).mockResolvedValue(savedParticipation);
    renderDashboard();
    fireEvent.click(await screen.findByRole("button", { name: "Available" }));
    await waitFor(() => expect(toggleCandyStatus).toHaveBeenCalledWith("restored-house", { status: "available", publicOptIn: true }));
    expect(await screen.findByText("Saved: Available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Available" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["available", "low", "finished"] as const)("restores the saved %s selection on return to Resident", async (status) => {
    useAuthMock.mockReturnValue({ user: { sub: "resident-1" }, isConfigured: true, signIn: vi.fn(), signOut: vi.fn() });
    vi.mocked(isLiveApiConfigured).mockReturnValue(true);
    vi.mocked(fetchMyClaims).mockResolvedValue([{
      houseId: "restored-house", userId: "resident-1", status: "approved",
      verificationLevel: "organizer_approved", createdAt: "now", updatedAt: "now",
      participation: { ...savedParticipation, status },
    }]);
    renderDashboard();
    const label = { available: "Available", low: "Running low", finished: "Finished" }[status];
    expect(await screen.findByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(toggleCandyStatus).not.toHaveBeenCalled();
  });

  it("keeps the previous selection during a save and after a failed save", async () => {
    useAuthMock.mockReturnValue({ user: { sub: "resident-1" }, isConfigured: true, signIn: vi.fn(), signOut: vi.fn() });
    vi.mocked(isLiveApiConfigured).mockReturnValue(true);
    vi.mocked(fetchMyClaims).mockResolvedValue([{
      houseId: "restored-house", userId: "resident-1", status: "approved",
      verificationLevel: "organizer_approved", createdAt: "now", updatedAt: "now", participation: savedParticipation,
    }]);
    let rejectSave!: (reason: Error) => void;
    vi.mocked(toggleCandyStatus).mockReturnValue(new Promise((_resolve, reject) => { rejectSave = reject; }));
    renderDashboard();
    fireEvent.click(await screen.findByRole("button", { name: "Running low" }));
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Available" })).toHaveAttribute("aria-pressed", "true");
    rejectSave(new Error("Could not reach the server"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
    expect(screen.getByRole("button", { name: "Available" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Running low" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/^Saved:/)).not.toBeInTheDocument();
  });

  it("associates a confirmed house with the selected containing neighborhood", async () => {
    useAuthMock.mockReturnValue({ user: { sub: "resident-1" }, isConfigured: true, signIn: vi.fn(), signOut: vi.fn() });
    vi.mocked(isLiveApiConfigured).mockReturnValue(true);
    vi.mocked(fetchMyClaims).mockResolvedValue([]);
    vi.mocked(fetchNeighborhoodsNear).mockResolvedValue([SEED_NEIGHBORHOOD]);
    vi.mocked(resolveHouse).mockResolvedValue({
      created: true, house: {
        id: "house-1", neighborhoodId: SEED_NEIGHBORHOOD.id, point: SEED_NEIGHBORHOOD.centroid,
        canonicalAddressKey: "key", addressDisplayPrivate: "123 Example St", visibility: "public", createdAt: "now",
      },
    });
    vi.mocked(submitClaim).mockResolvedValue({
      houseId: "house-1", userId: "resident-1", status: "pending", verificationLevel: "self_reported",
      createdAt: "now", updatedAt: "now",
    });
    renderDashboard();
    fireEvent.change(await screen.findByLabelText("Street address"), { target: { value: "123 Example St" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "94117" } });
    await waitFor(() => expect(screen.getByLabelText("Neighborhood")).toHaveValue(SEED_NEIGHBORHOOD.id));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Claim this house" }));
    expect(await screen.findByText("Pending organizer approval")).toBeInTheDocument();
    expect(resolveHouse).toHaveBeenCalledWith(expect.objectContaining({ neighborhoodId: SEED_NEIGHBORHOOD.id }));
    expect(submitClaim).toHaveBeenCalledWith("house-1");
  });

  it("rejects a house point outside the selected boundary", async () => {
    useAuthMock.mockReturnValue({ user: { sub: "resident-1" }, isConfigured: true, signIn: vi.fn(), signOut: vi.fn() });
    vi.mocked(isLiveApiConfigured).mockReturnValue(true);
    vi.mocked(fetchMyClaims).mockResolvedValue([]);
    vi.mocked(fetchNeighborhoodsNear).mockResolvedValue([SEED_NEIGHBORHOOD]);
    renderDashboard();
    fireEvent.change(await screen.findByLabelText("Street address"), { target: { value: "123 Example St" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "94117" } });
    await waitFor(() => expect(screen.getByLabelText("Neighborhood")).toHaveValue(SEED_NEIGHBORHOOD.id));
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "10" } });
    await waitFor(() => expect(screen.queryByText("Finding neighborhoods...")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Claim this house" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("inside the selected neighborhood boundary");
    expect(resolveHouse).not.toHaveBeenCalled();
  });
});
