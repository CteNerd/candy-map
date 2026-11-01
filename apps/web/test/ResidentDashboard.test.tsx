import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SEED_NEIGHBORHOOD } from "../src/lib/fixtures";

const useAuthMock = vi.fn();
const savedParticipation = {
  houseId: "restored-house", eventId: "halloween-2026", status: "available" as const,
  publicOptIn: true, updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("../src/lib/api", () => ({
  fetchMyClaims: vi.fn().mockResolvedValue([]),
  isLiveApiConfigured: vi.fn().mockReturnValue(false),
  fetchNeighborhoodsNear: vi.fn().mockResolvedValue([]),
  resolveHouse: vi.fn(),
  submitClaim: vi.fn(),
  updateEventParticipation: vi.fn(),
}));
vi.mock("../src/map/GoogleMap", () => ({ GoogleMap: () => <div data-testid="house-map" /> }));
vi.mock("../src/map/AddressSearch", () => ({ AddressSearch: () => <div /> }));

import { ResidentDashboard } from "../src/screens/ResidentDashboard";
import { fetchMyClaims, fetchNeighborhoodsNear, isLiveApiConfigured, resolveHouse, submitClaim, updateEventParticipation } from "../src/lib/api";

function renderDashboard(path = "/dashboard?eventId=halloween-2026") {
  return render(<MemoryRouter initialEntries={[path]}><ResidentDashboard /></MemoryRouter>);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T20:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(isLiveApiConfigured).mockReturnValue(false);
  vi.useRealTimers();
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
    vi.mocked(updateEventParticipation).mockResolvedValue(savedParticipation);
    renderDashboard();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(await screen.findByRole("button", { name: "Available" }));
    await waitFor(() => expect(updateEventParticipation).toHaveBeenCalledWith("restored-house", "halloween-2026", { status: "available", publicOptIn: true }));
    expect(await screen.findByText("Saved: Available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Available" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["available", "low", "finished"] as const)("restores the saved %s selection on return to Resident", async (status) => {
    useAuthMock.mockReturnValue({ user: { sub: "resident-1" }, isConfigured: true, signIn: vi.fn(), signOut: vi.fn() });
    vi.mocked(isLiveApiConfigured).mockReturnValue(true);
    vi.mocked(fetchMyClaims).mockResolvedValue([{
      houseId: "restored-house", userId: "resident-1", status: "approved",
      verificationLevel: "organizer_approved", createdAt: "now", updatedAt: "now",
      participation: null, eventParticipation: { ...savedParticipation, status },
    }]);
    renderDashboard();
    const label = { available: "Available", low: "Running low", finished: "Finished" }[status];
    expect(await screen.findByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(updateEventParticipation).not.toHaveBeenCalled();
  });

  it("keeps the previous selection during a save and after a failed save", async () => {
    useAuthMock.mockReturnValue({ user: { sub: "resident-1" }, isConfigured: true, signIn: vi.fn(), signOut: vi.fn() });
    vi.mocked(isLiveApiConfigured).mockReturnValue(true);
    vi.mocked(fetchMyClaims).mockResolvedValue([{
      houseId: "restored-house", userId: "resident-1", status: "approved",
      verificationLevel: "organizer_approved", createdAt: "now", updatedAt: "now", participation: null, eventParticipation: savedParticipation,
    }]);
    let rejectSave!: (reason: Error) => void;
    vi.mocked(updateEventParticipation).mockReturnValue(new Promise((_resolve, reject) => { rejectSave = reject; }));
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

  it("requires an explicit publication choice for Christmas and never uses candy participation", async () => {
    vi.setSystemTime(new Date("2026-12-01T20:00:00Z"));
    useAuthMock.mockReturnValue({ user: { sub: "resident-1" }, isConfigured: true, signIn: vi.fn(), signOut: vi.fn() });
    vi.mocked(isLiveApiConfigured).mockReturnValue(true);
    vi.mocked(fetchMyClaims).mockResolvedValue([{
      houseId: "restored-house", userId: "resident-1", status: "approved", verificationLevel: "organizer_approved",
      createdAt: "now", updatedAt: "now", participation: null, eventParticipation: null,
    }]);
    vi.mocked(updateEventParticipation).mockResolvedValue({
      ...savedParticipation, eventId: "christmas-lights-2026", status: "displaying", publicOptIn: false,
    });
    renderDashboard("/dashboard?eventId=christmas-lights-2026");
    fireEvent.click(await screen.findByRole("button", { name: "Display listed" }));
    await waitFor(() => expect(updateEventParticipation).toHaveBeenCalledWith("restored-house", "christmas-lights-2026", { status: "displaying", publicOptIn: false }));
    expect(await screen.findByText(/Private — not on the public map/)).toBeInTheDocument();
    expect(fetchMyClaims).toHaveBeenCalledWith("christmas-lights-2026");
  });

  it("selects among independent houses without modifying the other house", async () => {
    useAuthMock.mockReturnValue({ user: { sub: "resident-1" }, isConfigured: true, signIn: vi.fn(), signOut: vi.fn() });
    vi.mocked(isLiveApiConfigured).mockReturnValue(true);
    vi.mocked(fetchMyClaims).mockResolvedValue(["h1", "h2"].map((houseId) => ({
      houseId, userId: "resident-1", status: "approved", verificationLevel: "organizer_approved",
      createdAt: "now", updatedAt: "now", participation: null, eventParticipation: null,
    })));
    vi.mocked(updateEventParticipation).mockResolvedValue({ ...savedParticipation, houseId: "h2", publicOptIn: false });
    renderDashboard();
    fireEvent.change(await screen.findByLabelText("My houses"), { target: { value: "h2" } });
    fireEvent.click(screen.getByRole("button", { name: "Available" }));
    await waitFor(() => expect(updateEventParticipation).toHaveBeenCalledWith("h2", "halloween-2026", { status: "available", publicOptIn: false }));
    expect(updateEventParticipation).toHaveBeenCalledTimes(1);
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
