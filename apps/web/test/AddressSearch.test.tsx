import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ load: vi.fn(), widget: vi.fn() }));
vi.mock("../src/map/googleMaps", () => ({ loadGoogleLibrary: mocks.load }));
import { AddressSearch } from "../src/map/AddressSearch";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Google address search", () => {
  it("retrieves minimal address fields and returns the selected house point", async () => {
    const element = document.createElement("div");
    mocks.widget.mockImplementation(function () { return element; });
    mocks.load.mockResolvedValue({ PlaceAutocompleteElement: mocks.widget });
    const selected = vi.fn();
    const fields = vi.fn().mockResolvedValue(undefined);
    const place = {
      fetchFields: fields, location: { lat: () => 10, lng: () => 20 },
      addressComponents: [
        { types: ["street_number"], longText: "123" }, { types: ["route"], longText: "Example St" },
        { types: ["postal_code"], longText: "94117" }, { types: ["country"], shortText: "US" },
      ],
    };
    const { unmount } = render(<AddressSearch onSelect={selected} />);
    await waitFor(() => expect(element.isConnected).toBe(true));
    const event = new Event("gmp-select");
    Object.defineProperty(event, "placePrediction", { value: { toPlace: () => place } });
    await act(async () => element.dispatchEvent(event));
    expect(fields).toHaveBeenCalledWith({ fields: ["location", "addressComponents"] });
    expect(selected).toHaveBeenCalledWith({ point: { lat: 10, lon: 20 }, street: "123 Example St", postalCode: "94117", country: "us" });
    unmount();
    expect(element.isConnected).toBe(false);
  });

  it("shows provider search errors and leaves manual location selection available", async () => {
    const element = document.createElement("div");
    mocks.widget.mockImplementation(function () { return element; });
    mocks.load.mockResolvedValue({ PlaceAutocompleteElement: mocks.widget });
    render(<AddressSearch onSelect={vi.fn()} />);
    await waitFor(() => expect(element.isConnected).toBe(true));
    act(() => element.dispatchEvent(new Event("gmp-error")));
    expect(screen.getByRole("alert")).toHaveTextContent("use the map");
  });
});
