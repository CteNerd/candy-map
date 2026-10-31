import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), refresh: vi.fn() }));
vi.mock("../src/auth/cognito", () => ({ exchangeCodeForTokens: mocks.exchange }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ refresh: mocks.refresh }) }));
import { AuthCallbackScreen } from "../src/screens/AuthCallbackScreen";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

function renderCallback() {
  window.history.replaceState(null, "", "/auth/callback?code=one-time&state=test");
  render(<StrictMode><MemoryRouter initialEntries={["/auth/callback"]}><Routes>
    <Route path="/auth/callback" element={<AuthCallbackScreen />} />
    <Route path="/dashboard" element={<h1>Signed in</h1>} />
  </Routes></MemoryRouter></StrictMode>);
}

describe("AuthCallbackScreen", () => {
  it("exchanges a one-time code once even in StrictMode", async () => {
    mocks.exchange.mockResolvedValue(true);
    renderCallback();
    expect(await screen.findByText("Signed in")).toBeInTheDocument();
    expect(mocks.exchange).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows token exchange network errors", async () => {
    mocks.exchange.mockRejectedValue(new Error("Network unavailable"));
    renderCallback();
    expect(await screen.findByText("Network unavailable")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
