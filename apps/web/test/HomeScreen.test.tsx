import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const useAuthMock = vi.fn();
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => useAuthMock() }));

import { HomeScreen } from "../src/screens/HomeScreen";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomeScreen", () => {
  it("explains event-isolated opt-in and links to the selected event", () => {
    useAuthMock.mockReturnValue({ user: null, isConfigured: false, signIn: vi.fn() });
    render(<MemoryRouter initialEntries={["/?eventId=christmas-lights-2026"]}><HomeScreen /></MemoryRouter>);

    expect(screen.getByRole("img", { name: "Neighborhood Celebrations" })).toHaveAttribute("src", "/share-card.png");
    expect(screen.getByText(/Halloween and Christmas listings are separate/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "One house, more than one helper" })).toBeInTheDocument();
    expect(screen.getByText(/Invite someone with a share link or email to help manage one house/)).toBeInTheDocument();
    expect(screen.getByText(/Community sightings and joint displays are not enabled yet/)).toBeInTheDocument();
    expect(screen.getByText(/precise location can reveal where someone lives/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore the map" })).toHaveAttribute("href", "/map?eventId=christmas-lights-2026");
    expect(screen.getByRole("link", { name: "Manage my home" })).toHaveAttribute("href", "/dashboard?eventId=christmas-lights-2026");
    expect(screen.getByRole("link", { name: "Privacy and removal" })).toHaveAttribute("href", "/privacy");
  });

  it("offers sign-in when authentication is configured", () => {
    const signIn = vi.fn();
    useAuthMock.mockReturnValue({ user: null, isConfigured: true, signIn });
    render(<MemoryRouter><HomeScreen /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalledOnce();
  });
});
