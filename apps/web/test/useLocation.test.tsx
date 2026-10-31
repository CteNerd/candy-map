import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { parsePoint, useLocation } from "../src/map/useLocation";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("location", () => {
  it("rejects incomplete, invalid and out-of-range coordinates", () => {
    for (const values of [[null, null], ["", "1"], ["NaN", "2"], ["90", "1"], ["1", "181"], ["1x", "2"]]) {
      expect(parsePoint(values[0]!, values[1]!)).toBeNull();
    }
    expect(parsePoint("0", "0")).toEqual({ lat: 0, lon: 0 });
  });

  it("locates with a bounded timeout and forwards coordinates", () => {
    const onLocate = vi.fn();
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({
      coords: { latitude: 10, longitude: 20 },
    } as GeolocationPosition));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    const { result } = renderHook(() => useLocation(onLocate));
    act(() => result.current.locate());
    expect(onLocate).toHaveBeenCalledWith({ lat: 10, lon: 20 });
    expect(result.current.location).toEqual({ lat: 10, lon: 20 });
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  });

  it.each([[1, "permission was denied"], [2, "Could not determine"], [3, "timed out"]])("surfaces location error %s", (code, message) => {
    vi.stubGlobal("navigator", { geolocation: {
      getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => failure({ code } as GeolocationPositionError),
    } });
    const onLocate = vi.fn();
    const { result } = renderHook(() => useLocation(onLocate));
    act(() => result.current.locate());
    expect(result.current.locationError).toContain(message);
    expect(result.current.locating).toBe(false);
    expect(onLocate).not.toHaveBeenCalled();
  });
});
