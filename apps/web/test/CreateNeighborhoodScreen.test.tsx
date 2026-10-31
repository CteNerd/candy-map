import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SEED_NEIGHBORHOOD } from "../src/lib/fixtures";
import type { MapViewProps } from "../src/map/MapAdapter";

const mocks = vi.hoisted(() => ({ create: vi.fn(), auth: vi.fn() }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: mocks.auth }));
vi.mock("../src/lib/api", () => ({ createNeighborhood: mocks.create, isLiveApiConfigured: () => true }));
vi.mock("../src/map/AddressSearch", () => ({ AddressSearch: () => <div /> }));
vi.mock("../src/map/GoogleMap", () => ({
  GoogleMap: ({ onMapClick }: MapViewProps) => <div>
    {SEED_NEIGHBORHOOD.polygon.coordinates[0]!.slice(0, -1).map(([lon, lat], index) =>
      <button key={index} onClick={() => onMapClick?.({ lat: lat!, lon: lon! })}>Corner {index + 1}</button>)}
  </div>,
}));
import { CreateNeighborhoodScreen } from "../src/screens/CreateNeighborhoodScreen";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("neighborhood creation", () => {
  it("requires sign-in", () => {
    mocks.auth.mockReturnValue({ isConfigured: true, user: null, signIn: vi.fn() });
    render(<MemoryRouter><CreateNeighborhoodScreen /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("saves a closed boundary and offers house association", async () => {
    mocks.auth.mockReturnValue({ isConfigured: true, user: { sub: "organizer" }, signIn: vi.fn() });
    mocks.create.mockResolvedValue(SEED_NEIGHBORHOOD);
    render(<MemoryRouter><CreateNeighborhoodScreen /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Neighborhood name"), { target: { value: "Maple Hollow" } });
    expect(screen.getByRole("button", { name: "Create neighborhood" })).toBeDisabled();
    [1, 2, 3, 4].forEach((index) => fireEvent.click(screen.getByRole("button", { name: `Corner ${index}` })));
    fireEvent.click(screen.getByRole("button", { name: "Create neighborhood" }));
    expect(await screen.findByRole("link", { name: "Associate my house" })).toHaveAttribute("href",
      expect.stringContaining(`neighborhood=${SEED_NEIGHBORHOOD.id}`));
    expect(mocks.create).toHaveBeenCalledWith({ name: "Maple Hollow", polygon: SEED_NEIGHBORHOOD.polygon });
  });

  it("surfaces duplicate-neighborhood rejection without claiming success", async () => {
    mocks.auth.mockReturnValue({ isConfigured: true, user: { sub: "organizer" }, signIn: vi.fn() });
    mocks.create.mockRejectedValue(new Error("This boundary overlaps an existing neighborhood too closely"));
    render(<MemoryRouter><CreateNeighborhoodScreen /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Neighborhood name"), { target: { value: "Duplicate" } });
    [1, 2, 3, 4].forEach((index) => fireEvent.click(screen.getByRole("button", { name: `Corner ${index}` })));
    fireEvent.click(screen.getByRole("button", { name: "Create neighborhood" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("overlaps an existing neighborhood");
    expect(screen.queryByRole("link", { name: "Associate my house" })).not.toBeInTheDocument();
  });
});
