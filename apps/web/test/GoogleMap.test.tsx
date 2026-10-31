import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { SEED_NEIGHBORHOOD } from "../src/lib/fixtures";

const mocks = vi.hoisted(() => ({
  load: vi.fn(), pan: vi.fn(), polygon: vi.fn(), clear: vi.fn(),
  removePolygon: vi.fn(), listeners: new Map<string, (event?: unknown) => void>(),
  markers: [] as { map: unknown; position: unknown; content?: HTMLElement }[],
}));
vi.mock("../src/map/googleMaps", () => ({ GOOGLE_MAP_ID: "test-map-id", loadGoogleLibrary: mocks.load }));
import { GoogleMap } from "../src/map/GoogleMap";

beforeEach(() => {
  mocks.listeners.clear();
  mocks.markers.length = 0;
  class FakeMap {
    panTo = mocks.pan;
    addListener(name: string, callback: (event?: unknown) => void) {
      mocks.listeners.set(name, callback);
      return { remove: vi.fn() };
    }
    getCenter() { return { lat: () => 10, lng: () => 20 }; }
  }
  class Polygon {
    constructor(options: unknown) { mocks.polygon(options); }
    setMap = mocks.removePolygon;
  }
  class AdvancedMarkerElement {
    map: unknown;
    position: unknown;
    content?: HTMLElement;
    constructor(options: { map: unknown; position: unknown; content?: HTMLElement }) {
      this.map = options.map; this.position = options.position; this.content = options.content; mocks.markers.push(this);
    }
  }
  vi.stubGlobal("google", { maps: { Polygon, marker: { AdvancedMarkerElement }, event: { clearInstanceListeners: mocks.clear } } });
  mocks.load.mockImplementation(async () => ({ Map: FakeMap }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("GoogleMap", () => {
  it("updates its center and renders the boundary and candy marker", async () => {
    const onPinClick = vi.fn();
    const props = {
      center: SEED_NEIGHBORHOOD.centroid, boundary: SEED_NEIGHBORHOOD.polygon.coordinates[0],
      pins: [{ id: "house", point: SEED_NEIGHBORHOOD.centroid, status: "available" as const }], onPinClick,
    };
    const { rerender, unmount } = render(<GoogleMap {...props} />);
    await waitFor(() => expect(mocks.polygon).toHaveBeenCalled());
    expect(mocks.polygon).toHaveBeenCalledWith(expect.objectContaining({
      paths: props.boundary!.map(([lng, lat]) => ({ lat, lng })),
    }));
    expect(mocks.markers[0]?.content?.getAttribute("aria-label")).toBe("Candy house, status available");
    mocks.markers[0]?.content?.click();
    expect(onPinClick).toHaveBeenCalledWith("house");
    rerender(<GoogleMap {...props} center={{ lat: 10, lon: 20 }} />);
    await waitFor(() => expect(mocks.pan).toHaveBeenLastCalledWith({ lat: 10, lng: 20 }));
    unmount();
    expect(mocks.markers.every((marker) => marker.map === null)).toBe(true);
    expect(mocks.removePolygon).toHaveBeenCalledWith(null);
  });

  it("reports map clicks and camera movement using domain coordinates", async () => {
    const click = vi.fn(), move = vi.fn();
    render(<GoogleMap center={SEED_NEIGHBORHOOD.centroid} pins={[]} onMapClick={click} onCenterChange={move} />);
    await waitFor(() => expect(mocks.listeners.has("idle")).toBe(true));
    act(() => {
      mocks.listeners.get("click")?.({ latLng: { lat: () => 11, lng: () => 22 } });
      mocks.listeners.get("idle")?.();
    });
    expect(click).toHaveBeenCalledWith({ lat: 11, lon: 22 });
    expect(move).toHaveBeenCalledWith({ lat: 10, lon: 20 });
  });

  it("surfaces provider loading and authorization errors", async () => {
    mocks.load.mockRejectedValue(new Error("Map network failed"));
    render(<GoogleMap center={SEED_NEIGHBORHOOD.centroid} pins={[]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Map network failed");
    act(() => window.dispatchEvent(new Event("google-maps-auth-failure")));
    expect(screen.getByRole("alert")).toHaveTextContent("authorization failed");
  });
});
