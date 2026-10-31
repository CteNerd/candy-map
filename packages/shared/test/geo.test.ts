import { describe, expect, it } from "vitest";
import {
  classifyOverlap,
  computePolygonOverlap,
  gridCellId,
  isPointInPolygon,
  validatePolygon,
} from "../src/geo.js";
import type { PolygonGeoJSON } from "../src/types.js";

function square(minLon: number, minLat: number, maxLon: number, maxLat: number): PolygonGeoJSON {
  return {
    type: "Polygon",
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}

describe("validatePolygon", () => {
  it("accepts a reasonable closed square", () => {
    const result = validatePolygon(square(-122.42, 37.77, -122.41, 37.78));
    expect(result.valid).toBe(true);
  });

  it("rejects an unclosed ring", () => {
    const polygon: PolygonGeoJSON = {
      type: "Polygon",
      coordinates: [
        [
          [-122.42, 37.77],
          [-122.41, 37.77],
          [-122.41, 37.78],
        ],
      ],
    };
    const result = validatePolygon(polygon);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/closed/);
  });

  it("rejects a self-intersecting (bowtie) polygon", () => {
    const bowtie: PolygonGeoJSON = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    const result = validatePolygon(bowtie);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/self-intersecting/);
  });

  it("rejects an implausibly tiny polygon", () => {
    const tiny = square(-122.42, 37.77, -122.419999, 37.770001);
    const result = validatePolygon(tiny);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/small/);
  });
});

describe("isPointInPolygon", () => {
  const polygon = square(-122.42, 37.77, -122.41, 37.78);

  it("returns true for a point well inside", () => {
    expect(isPointInPolygon({ lat: 37.775, lon: -122.415 }, polygon)).toBe(true);
  });

  it("returns false for a point well outside", () => {
    expect(isPointInPolygon({ lat: 37.9, lon: -122.0 }, polygon)).toBe(false);
  });

  it("treats an exact vertex as inside (boundary case)", () => {
    expect(isPointInPolygon({ lat: 37.77, lon: -122.42 }, polygon)).toBe(true);
  });

  it("treats a point exactly on an edge as inside (boundary case)", () => {
    expect(isPointInPolygon({ lat: 37.77, lon: -122.415 }, polygon)).toBe(true);
  });
});

describe("computePolygonOverlap / classifyOverlap", () => {
  it("classifies non-overlapping polygons as none", () => {
    const a = square(0, 0, 1, 1);
    const b = square(10, 10, 11, 11);
    const overlap = computePolygonOverlap(a, b);
    expect(overlap.intersectionAreaSqMeters).toBe(0);
    expect(classifyOverlap(overlap)).toBe("none");
  });

  it("classifies near-identical polygons as blocked", () => {
    const a = square(-122.42, 37.77, -122.40, 37.79);
    const b = square(-122.4199, 37.7701, -122.4001, 37.7899);
    const overlap = computePolygonOverlap(a, b);
    expect(classifyOverlap(overlap)).toBe("blocked");
  });

  it("classifies a small section fully inside a larger polygon as blocked via overlapOfProposed", () => {
    const largeExisting = square(0, 0, 10, 10);
    const smallSectionInside = square(2, 2, 3, 3);
    const overlap = computePolygonOverlap(smallSectionInside, largeExisting);
    expect(overlap.overlapOfProposed).toBeCloseTo(1, 2);
    expect(overlap.overlapOfExisting).toBeLessThan(0.1);
    expect(classifyOverlap(overlap)).toBe("blocked");
  });

  it("classifies partial overlap as review, not none or blocked", () => {
    const a = square(0, 0, 2, 2);
    const b = square(1, 1, 3, 3);
    const overlap = computePolygonOverlap(a, b);
    expect(classifyOverlap(overlap)).toBe("review");
  });
});

describe("gridCellId", () => {
  it("is stable for nearby points in the same cell", () => {
    const a = gridCellId({ lat: 37.771, lon: -122.419 }, 0.05);
    const b = gridCellId({ lat: 37.772, lon: -122.418 }, 0.05);
    expect(a).toBe(b);
  });

  it("differs across a cell boundary", () => {
    const a = gridCellId({ lat: 37.70, lon: -122.40 }, 0.05);
    const b = gridCellId({ lat: 37.76, lon: -122.40 }, 0.05);
    expect(a).not.toBe(b);
  });
});
