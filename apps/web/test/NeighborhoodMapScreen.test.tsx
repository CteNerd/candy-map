import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MapViewProps } from "../src/map/MapAdapter";

vi.mock("../src/map/GoogleMap", () => ({
  GoogleMap: ({ center }: MapViewProps) => <div data-testid="mock-map" data-lat={center.lat} data-lon={center.lon} />,
}));
vi.mock("../src/map/AddressSearch", () => ({ AddressSearch: () => <div /> }));
vi.mock("../src/lib/api", async () => {
  const { SEED_NEIGHBORHOOD, SEED_HOUSE_PINS } = await import("../src/lib/fixtures");
  return {
    fetchNeighborhoodsNear: vi.fn().mockResolvedValue([SEED_NEIGHBORHOOD]),
    fetchNeighborhoodHouses: vi.fn().mockResolvedValue(SEED_HOUSE_PINS),
  };
});
import { fetchNeighborhoodHouses, fetchNeighborhoodsNear } from "../src/lib/api";

import { NeighborhoodMapScreen } from "../src/screens/NeighborhoodMapScreen";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("NeighborhoodMapScreen", () => {
  it("requests the selected edition and preserves it in neighborhood navigation", async () => {
    render(<MemoryRouter initialEntries={["/?eventId=christmas-lights-2026"]}><NeighborhoodMapScreen /></MemoryRouter>);
    await waitFor(() => expect(fetchNeighborhoodHouses).toHaveBeenCalledWith("nbhd-maple-hollow", "christmas-lights-2026"));
    expect(screen.getByRole("link", { name: /Associate my house/ })).toHaveAttribute("href", expect.stringContaining("eventId=christmas-lights-2026"));
  });

  it("shows an error for invalid editions without loading another event", async () => {
    render(<MemoryRouter initialEntries={["/?eventId=invalid"]}><NeighborhoodMapScreen /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("not supported");
    expect(fetchNeighborhoodHouses).not.toHaveBeenCalled();
  });
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

  it("honors shared coordinates instead of requesting the user's location", async () => {
    const locate = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: locate } });
    render(<MemoryRouter initialEntries={["/?lat=10&lon=20"]}><NeighborhoodMapScreen /></MemoryRouter>);
    await waitFor(() => expect(fetchNeighborhoodsNear).toHaveBeenCalledWith(10, 20));
    expect(screen.getByTestId("mock-map")).toHaveAttribute("data-lat", "10");
    expect(locate).not.toHaveBeenCalled();
  });

  it("uses location results to update both map and neighborhood lookup", async () => {
    vi.stubGlobal("navigator", { geolocation: {
      getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: 11, longitude: 22 } } as GeolocationPosition),
    } });
    render(<MemoryRouter><NeighborhoodMapScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    await waitFor(() => expect(fetchNeighborhoodsNear).toHaveBeenCalledWith(11, 22));
    expect(screen.getByTestId("mock-map")).toHaveAttribute("data-lon", "22");
  });
});
