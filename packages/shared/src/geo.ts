/**
 * Geospatial validation and duplicate-detection helpers.
 *
 * Implements the geometry rules from COPILOT_PLAN.md:
 *  - "Neighborhood duplicate prevention": polygon validation, bbox candidate filtering, overlap
 *    computed both ways (intersection / proposed area, intersection / existing area).
 *  - "House duplicate prevention": point-in-polygon for address-inside-neighborhood checks.
 */

import * as turf from "@turf/turf";
import type { BoundingBox, GeoPoint, PolygonGeoJSON } from "./types.js";

/** Coarse supported region for this POC — reject polygons/points far outside it. Update per deployment. */
export const SUPPORTED_REGION_BBOX: BoundingBox = {
  minLat: -85,
  minLon: -180,
  maxLat: 85,
  maxLon: 180,
};

export interface PolygonValidationResult {
  valid: boolean;
  errors: string[];
  areaSqMeters?: number;
}

const MIN_AREA_SQ_METERS = 50; // smaller than this is almost certainly a mis-drawn point-click
const MAX_AREA_SQ_METERS = 20_000_000; // ~20 km^2 ceiling for a single "neighborhood" POC

function ringIsClosed(ring: number[][]): boolean {
  if (ring.length < 4) return false;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1];
}

/**
 * Validates a proposed neighborhood polygon: closed ring, at least a triangle, non-self-
 * intersecting, reasonable area, and inside the supported geographic region.
 */
export function validatePolygon(polygon: PolygonGeoJSON): PolygonValidationResult {
  const errors: string[] = [];
  const ring = polygon.coordinates[0];

  if (!ring || !ringIsClosed(ring)) {
    errors.push("Polygon ring must be closed (first and last coordinate equal).");
    return { valid: false, errors };
  }

  let feature;
  try {
    feature = turf.polygon(polygon.coordinates);
  } catch (err) {
    errors.push(`Invalid polygon geometry: ${(err as Error).message}`);
    return { valid: false, errors };
  }

  const kinks = turf.kinks(feature);
  if (kinks.features.length > 0) {
    errors.push("Polygon is self-intersecting.");
  }

  const bbox = turf.bbox(feature);
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const inRegion =
    minLat! >= SUPPORTED_REGION_BBOX.minLat &&
    maxLat! <= SUPPORTED_REGION_BBOX.maxLat &&
    minLon! >= SUPPORTED_REGION_BBOX.minLon &&
    maxLon! <= SUPPORTED_REGION_BBOX.maxLon;
  if (!inRegion) {
    errors.push("Polygon falls outside the supported geographic region.");
  }

  const areaSqMeters = turf.area(feature);
  if (areaSqMeters < MIN_AREA_SQ_METERS) {
    errors.push(`Polygon area is implausibly small (${areaSqMeters.toFixed(1)} m^2).`);
  }
  if (areaSqMeters > MAX_AREA_SQ_METERS) {
    errors.push(`Polygon area is implausibly large (${areaSqMeters.toFixed(1)} m^2).`);
  }

  return { valid: errors.length === 0, errors, areaSqMeters };
}

export function computeBoundingBox(polygon: PolygonGeoJSON): BoundingBox {
  const feature = turf.polygon(polygon.coordinates);
  const [minLon, minLat, maxLon, maxLat] = turf.bbox(feature);
  return { minLat: minLat!, minLon: minLon!, maxLat: maxLat!, maxLon: maxLon! };
}

export function computeCentroid(polygon: PolygonGeoJSON): GeoPoint {
  const feature = turf.polygon(polygon.coordinates);
  const [lon, lat] = turf.centroid(feature).geometry.coordinates;
  return { lat: lat!, lon: lon! };
}

export function isPointInPolygon(point: GeoPoint, polygon: PolygonGeoJSON): boolean {
  const pt = turf.point([point.lon, point.lat]);
  const poly = turf.polygon(polygon.coordinates);
  return turf.booleanPointInPolygon(pt, poly, { ignoreBoundary: false });
}

export function boundingBoxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

export interface PolygonOverlapResult {
  /** intersection area / proposed (new) polygon area, in [0, 1]. */
  overlapOfProposed: number;
  /** intersection area / existing polygon area, in [0, 1]. */
  overlapOfExisting: number;
  intersectionAreaSqMeters: number;
}

/**
 * Computes bidirectional overlap between a proposed polygon and an existing one. Both directions
 * matter: a new "section" can sit entirely inside a larger existing polygon (overlapOfProposed
 * near 1, overlapOfExisting small), which is still a containment duplicate.
 */
export function computePolygonOverlap(proposed: PolygonGeoJSON, existing: PolygonGeoJSON): PolygonOverlapResult {
  const proposedFeature = turf.polygon(proposed.coordinates);
  const existingFeature = turf.polygon(existing.coordinates);

  const proposedArea = turf.area(proposedFeature);
  const existingArea = turf.area(existingFeature);

  let intersectionAreaSqMeters = 0;
  try {
    const intersection = turf.intersect(turf.featureCollection([proposedFeature, existingFeature]));
    if (intersection) {
      intersectionAreaSqMeters = turf.area(intersection);
    }
  } catch {
    // Degenerate geometries (e.g. touching only at an edge) — treat as no overlap.
    intersectionAreaSqMeters = 0;
  }

  return {
    overlapOfProposed: proposedArea > 0 ? intersectionAreaSqMeters / proposedArea : 0,
    overlapOfExisting: existingArea > 0 ? intersectionAreaSqMeters / existingArea : 0,
    intersectionAreaSqMeters,
  };
}

export const DUPLICATE_BLOCK_THRESHOLD = 0.8;
export const DUPLICATE_REVIEW_THRESHOLD = 0.1;

export type DuplicateVerdict = "blocked" | "review" | "none";

export function classifyOverlap(overlap: PolygonOverlapResult): DuplicateVerdict {
  const maxOverlap = Math.max(overlap.overlapOfProposed, overlap.overlapOfExisting);
  if (maxOverlap >= DUPLICATE_BLOCK_THRESHOLD) return "blocked";
  if (maxOverlap >= DUPLICATE_REVIEW_THRESHOLD) return "review";
  return "none";
}

/**
 * Coarse spatial grid cell id for a point, used for candidate-neighborhood querying and for the
 * single-region POC's creation-reservation lock key. This is a simple fixed-size lat/lon grid,
 * *not* a true geohash — see README "Known limitations" for why a real geohash/S2-based scheme
 * is required before scaling beyond one region (coarse single cells can't shard a global write
 * hot-spot or handle polygons spanning many cells cleanly).
 */
export function gridCellId(point: GeoPoint, cellSizeDegrees = 0.05): string {
  const cellLat = Math.floor(point.lat / cellSizeDegrees);
  const cellLon = Math.floor(point.lon / cellSizeDegrees);
  return `cell:${cellLat}:${cellLon}`;
}

/** All grid cells a bounding box touches, for coarse candidate-neighborhood lookups. */
export function gridCellIdsForBoundingBox(bbox: BoundingBox, cellSizeDegrees = 0.05): string[] {
  const cells: string[] = [];
  const minCellLat = Math.floor(bbox.minLat / cellSizeDegrees);
  const maxCellLat = Math.floor(bbox.maxLat / cellSizeDegrees);
  const minCellLon = Math.floor(bbox.minLon / cellSizeDegrees);
  const maxCellLon = Math.floor(bbox.maxLon / cellSizeDegrees);
  for (let latCell = minCellLat; latCell <= maxCellLat; latCell++) {
    for (let lonCell = minCellLon; lonCell <= maxCellLon; lonCell++) {
      cells.push(`cell:${latCell}:${lonCell}`);
    }
  }
  return cells;
}
