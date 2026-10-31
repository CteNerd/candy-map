import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("public API deployment modes", () => {
  it("uses fixtures only when no live API is configured", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    const { fetchNeighborhoodsNear } = await import("../src/lib/api");
    expect((await fetchNeighborhoodsNear(37.7765, -122.428))[0].name).toBe("Maple Hollow");
  });

  it("does not replace live network errors with demo neighborhoods", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failed")));
    const { fetchNeighborhoodsNear } = await import("../src/lib/api");
    await expect(fetchNeighborhoodsNear(37.7765, -122.428)).rejects.toThrow("Network failed");
  });

  it("does not replace live HTTP errors with demo pins", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
    const { fetchNeighborhoodHouses } = await import("../src/lib/api");
    await expect(fetchNeighborhoodHouses("real-neighborhood")).rejects.toThrow("503");
  });

  it.each([[true, "/api"], [false, "https://api.example.com"]])("uses the correct API origin in development=%s", async (dev, base) => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    vi.stubEnv("DEV", dev);
    const fetch = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { fetchNeighborhoodsNear } = await import("../src/lib/api");
    await fetchNeighborhoodsNear(10, 20);
    expect(fetch).toHaveBeenCalledWith(`${base}/neighborhoods?lat=10&lon=20`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});
