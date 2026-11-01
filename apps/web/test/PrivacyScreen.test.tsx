import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  submit: vi.fn(),
  fetch: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: mocks.auth }));
vi.mock("../src/lib/api", () => ({
  submitPrivacyRequest: mocks.submit,
  fetchPrivacyRequests: mocks.fetch,
  resolvePrivacyRequest: mocks.resolve,
}));

import { PrivacyScreen } from "../src/screens/PrivacyScreen";

function renderPrivacy() {
  return render(<MemoryRouter><PrivacyScreen /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PrivacyScreen", () => {
  it("allows an unauthenticated removal request and only shows generic success", async () => {
    mocks.auth.mockReturnValue({ user: null });
    mocks.submit.mockResolvedValue({ id: "request-1", state: "pending" });
    renderPrivacy();

    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "123 Sample Street" } });
    fireEvent.change(screen.getByLabelText("Unit (optional)"), { target: { value: "Unit 4" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "00000" } });
    expect(screen.getByLabelText("Country code")).toHaveValue("US");
    fireEvent.change(screen.getByLabelText("Request type"), { target: { value: "remove" } });
    fireEvent.change(screen.getByLabelText(/Additional details/), { target: { value: "Please unpublish this listing." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit privacy request" }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith({
      street: "123 Sample Street",
      unit: "Unit 4",
      postalCode: "00000",
      country: "US",
      mode: "remove",
      message: "Please unpublish this listing.",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Your request was received.");
    expect(screen.getByRole("status")).not.toHaveTextContent("123 Sample Street");
    expect(screen.queryByRole("heading", { name: "Private reviewer area" })).not.toBeInTheDocument();
    expect(screen.getByText(/Open maps may take up to 30 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/Resolved request details expire after 90 days and are deleted asynchronously; minimal blocks persist until reviewed restoration/)).toBeInTheDocument();
  });

  it("surfaces submission failures without claiming success", async () => {
    mocks.auth.mockReturnValue({ user: null });
    mocks.submit.mockRejectedValue(new Error("Service unavailable"));
    renderPrivacy();

    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "123 Sample Street" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "00000" } });
    expect(screen.getByLabelText("Country code")).toHaveValue("US");
    fireEvent.click(screen.getByRole("button", { name: "Submit privacy request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("loads the private queue only on demand and handles non-reviewer access explicitly", async () => {
    mocks.auth.mockReturnValue({ user: { sub: "signed-in-user" } });
    mocks.fetch.mockRejectedValue(new Error("Request failed with 403 Forbidden"));
    renderPrivacy();

    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Load review queue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You are not authorized to review privacy requests");
    expect(screen.getByRole("button", { name: "Submit privacy request" })).toBeInTheDocument();
    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
  });

  it("supports reviewer decisions with a note and explains that rejection keeps listings hidden", async () => {
    mocks.auth.mockReturnValue({ user: { sub: "privacy-reviewer" } });
    mocks.fetch.mockResolvedValue([{
      id: "request-2",
      address: "123 Sample Street, Unit 4, 00000, US",
      state: "pending",
      mode: "block",
      message: "Preemptive privacy request",
      createdAt: "2026-10-31T12:00:00Z",
    }]);
    mocks.resolve.mockResolvedValue({});
    renderPrivacy();

    fireEvent.click(screen.getByRole("button", { name: "Load review queue" }));
    expect(await screen.findByRole("heading", { name: "123 Sample Street, Unit 4, 00000, US" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "request-2" })).not.toBeInTheDocument();
    expect(screen.getByText(/Rejecting a request also keeps the listing hidden while the requester may appeal/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reviewer note"), { target: { value: "Reviewed authority." } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith("request-2", {
      decision: "reject",
      note: "Reviewed authority.",
    }));
    await waitFor(() => expect(screen.queryByText(/123 Sample Street, Unit 4/)).not.toBeInTheDocument());
  });

  it("requires a reviewer note and authority confirmation before restoring a privacy hold", async () => {
    mocks.auth.mockReturnValue({ user: { sub: "privacy-reviewer" } });
    mocks.fetch.mockResolvedValue([{
      id: "request-restore",
      address: "123 Sample Street, Unit 4, 00000, US",
      state: "blocked",
      mode: "block",
      message: "",
      createdAt: "2026-10-31T12:00:00Z",
    }]);
    mocks.resolve.mockResolvedValue({});
    renderPrivacy();

    fireEvent.click(screen.getByRole("button", { name: "Load review queue" }));
    await screen.findByRole("heading", { name: "123 Sample Street, Unit 4, 00000, US" });
    const restoreButton = screen.getByRole("button", { name: "Release privacy hold after review" });
    expect(restoreButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reviewer note"), { target: { value: "Authority and appeal reviewed." } });
    expect(restoreButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", {
      name: /I have reviewed property authority, conflicting requests, and any appeal before releasing the hold/,
    }));
    expect(restoreButton).toBeEnabled();
    fireEvent.click(restoreButton);

    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith("request-restore", {
      decision: "restore",
      note: "Authority and appeal reviewed.",
      authorityConfirmed: true,
    }));
  });
});
