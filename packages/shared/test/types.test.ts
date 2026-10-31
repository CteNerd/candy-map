import { describe, expect, it } from "vitest";
import { toPublicNeighborhood } from "../src/types.js";
import type { Neighborhood } from "../src/types.js";

const neighborhood: Neighborhood = {
  id: "n1",
  name: "Maple Hollow",
  normalizedName: "maple hollow",
  polygon: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  bbox: { minLat: 0, minLon: 0, maxLat: 1, maxLon: 1 },
  centroid: { lat: 0.5, lon: 0.5 },
  status: "active",
  organizerIds: ["user-123"],
  createdBy: "user-123",
  createdAt: "2024-01-01T00:00:00.000Z",
};

describe("toPublicNeighborhood", () => {
  it("omits organizerIds and createdBy (user identifiers)", () => {
    const pub = toPublicNeighborhood(neighborhood);
    expect(pub).not.toHaveProperty("organizerIds");
    expect(pub).not.toHaveProperty("createdBy");
    expect(pub).toEqual({
      id: "n1",
      name: "Maple Hollow",
      polygon: neighborhood.polygon,
      bbox: neighborhood.bbox,
      centroid: neighborhood.centroid,
      status: "active",
    });
  });
});
