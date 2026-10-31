import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";

const useAuthMock = vi.fn();
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("../src/lib/api", () => ({
  fetchMyClaims: vi.fn().mockResolvedValue([]),
  isLiveApiConfigured: vi.fn().mockReturnValue(false),
  fetchNeighborhoodsNear: vi.fn(),
  resolveHouse: vi.fn(),
  submitClaim: vi.fn(),
  toggleCandyStatus: vi.fn(),
}));

import { ResidentDashboard } from "../src/screens/ResidentDashboard";
import { fetchMyClaims, isLiveApiConfigured, toggleCandyStatus } from "../src/lib/api";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(isLiveApiConfigured).mockReturnValue(false);
});

describe("ResidentDashboard", () => {
  it("shows a setup message when Cognito isn't configured", () => {
    useAuthMock.mockReturnValue({ user: null, isConfigured: false, signIn: vi.fn(), signOut: vi.fn() });
    render(<ResidentDashboard />);
    expect(screen.getByText(/Sign-in isn't configured yet/)).toBeInTheDocument();
  });

  it("shows a sign-in button when configured but not authenticated", () => {
    const signIn = vi.fn();
    useAuthMock.mockReturnValue({ user: null, isConfigured: true, signIn, signOut: vi.fn() });
    render(<ResidentDashboard />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows the claim form once signed in", () => {
    useAuthMock.mockReturnValue({
      user: { sub: "resident-1", email: "resident@example.com" },
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    render(<ResidentDashboard />);
    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
    expect(screen.getByText(/Signed in as resident@example.com/)).toBeInTheDocument();
  });

  it("toggles a restored approved claim without needing a resolved house object", async () => {
    useAuthMock.mockReturnValue({ user: { sub: "resident-1" }, isConfigured: true, signIn: vi.fn(), signOut: vi.fn() });
    vi.mocked(isLiveApiConfigured).mockReturnValue(true);
    vi.mocked(fetchMyClaims).mockResolvedValue([{
      houseId: "restored-house", userId: "resident-1", status: "approved",
      verificationLevel: "organizer_approved", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }]);
    render(<ResidentDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "available" }));
    await waitFor(() => expect(toggleCandyStatus).toHaveBeenCalledWith("restored-house", { status: "available", publicOptIn: true }));
  });
});
