import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

const useAuthMock = vi.fn();
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("../src/lib/api", () => ({
  fetchMyClaims: vi.fn().mockResolvedValue([]),
  isLiveApiConfigured: () => false,
  resolveHouse: vi.fn(),
  submitClaim: vi.fn(),
  toggleCandyStatus: vi.fn(),
}));

import { ResidentDashboard } from "../src/screens/ResidentDashboard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
});
