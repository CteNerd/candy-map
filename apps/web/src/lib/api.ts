/**
 * Thin API client. If `VITE_API_BASE_URL` is configured, it calls the real public API
 * (Milestone 2); otherwise — and on any network failure — it falls back to the local seed
 * fixtures so the map/UI always has something to render. This keeps Milestone 1 (static seeded
 * map) fully working while making the eventual swap to the live API a one-line env var change.
 */
import type { Neighborhood, PublicHousePin } from "@candy-map/shared";
import { SEED_HOUSE_PINS, SEED_NEIGHBORHOOD } from "./fixtures";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;
const REQUEST_TIMEOUT_MS = 5000;

async function fetchJson<T>(path: string): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error("VITE_API_BASE_URL not configured");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request to ${path} failed with ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchNeighborhoodsNear(lat: number, lon: number): Promise<Neighborhood[]> {
  try {
    return await fetchJson<Neighborhood[]>(`/neighborhoods?lat=${lat}&lon=${lon}`);
  } catch (err) {
    console.warn("Falling back to seed neighborhood fixture:", (err as Error).message);
    return [SEED_NEIGHBORHOOD];
  }
}

export async function fetchNeighborhoodHouses(neighborhoodId: string): Promise<PublicHousePin[]> {
  try {
    return await fetchJson<PublicHousePin[]>(`/neighborhoods/${neighborhoodId}/houses`);
  } catch (err) {
    console.warn("Falling back to seed house pins fixture:", (err as Error).message);
    return SEED_HOUSE_PINS;
  }
}

export function isLiveApiConfigured(): boolean {
  return Boolean(API_BASE_URL);
}
