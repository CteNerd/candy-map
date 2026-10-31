import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/map/MapLibreMap", () => ({
  MapLibreMap: () => <div data-testid="mock-map" />,
}));

import { NeighborhoodMapScreen } from "../src/screens/NeighborhoodMapScreen";

afterEach(() => {
  cleanup();
});

describe("NeighborhoodMapScreen", () => {
  it("renders the seeded neighborhood name and opted-in house count", async () => {
    render(
      <MemoryRouter>
        <NeighborhoodMapScreen />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Maple Hollow")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/houses? opted in/)).toBeInTheDocument());
    expect(screen.getByTestId("mock-map")).toBeInTheDocument();
  });
});
