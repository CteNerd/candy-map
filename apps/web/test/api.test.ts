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
});
