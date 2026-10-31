/**
 * Milestone 1 seed data: one neighborhood + a handful of opted-in candy pins, rendered directly
 * so the map works end-to-end before the real API exists (Milestone 2 swaps `lib/api.ts` over to
 * fetching these shapes from the public API, falling back to these fixtures if unreachable).
 */
import type { Neighborhood, PublicHousePin } from "@candy-map/shared";

/** Relative timestamp so the static demo always looks "fresh" regardless of when it's viewed. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export const SEED_NEIGHBORHOOD: Neighborhood = {
  id: "nbhd-maple-hollow",
  name: "Maple Hollow",
  normalizedName: "maple hollow",
  polygon: {
    type: "Polygon",
    coordinates: [
      [
        [-122.4312, 37.7735],
        [-122.4248, 37.7735],
        [-122.4248, 37.7795],
        [-122.4312, 37.7795],
        [-122.4312, 37.7735],
      ],
    ],
  },
  bbox: { minLon: -122.4312, minLat: 37.7735, maxLon: -122.4248, maxLat: 37.7795 },
  centroid: { lat: 37.7765, lon: -122.428 },
  status: "active",
  organizerIds: ["seed-organizer-1"],
  createdBy: "seed-organizer-1",
  createdAt: "2024-10-01T00:00:00.000Z",
};

export const SEED_HOUSE_PINS: PublicHousePin[] = [
  { id: "house-1", point: { lat: 37.774, lon: -122.4302 }, status: "available", updatedAt: minutesAgo(2) },
  { id: "house-2", point: { lat: 37.7752, lon: -122.429 }, status: "available", updatedAt: minutesAgo(5) },
  { id: "house-3", point: { lat: 37.776, lon: -122.428 }, status: "low", updatedAt: minutesAgo(12) },
  { id: "house-4", point: { lat: 37.7775, lon: -122.427 }, status: "available", updatedAt: minutesAgo(1) },
];
// Note: a "finished" house is intentionally absent here — per the API contract,
// GET /neighborhoods/{id}/houses only ever returns opted-in *active* statuses, so a finished
// house simply stops appearing rather than being returned with a "finished" pill.
