/**
 * Thin API client. If `VITE_API_BASE_URL` is configured, it calls the real public API
 * (Milestone 2); otherwise — and on any network failure — it falls back to the local seed
 * fixtures so the map/UI always has something to render. This keeps Milestone 1 (static seeded
 * map) fully working while making the eventual swap to the live API a one-line env var change.
 */
import type { CandyParticipation, CandyStatus, House, HouseClaim, Neighborhood, PublicHousePin } from "@candy-map/shared";
import { SEED_HOUSE_PINS, SEED_NEIGHBORHOOD } from "./fixtures";
import { getIdToken } from "../auth/cognito";

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

// --- Authenticated calls (Milestone 3) -------------------------------------
// These never silently fall back to fixtures — a failed mutation must surface as an error, not a
// misleading fake success.

async function authenticatedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error("VITE_API_BASE_URL not configured");
  }
  const idToken = getIdToken();
  if (!idToken) {
    throw new Error("Sign in required.");
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}`, ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((body as { error?: string }).error ?? `Request to ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export interface ResolveHouseRequest {
  neighborhoodId: string;
  street: string;
  unit?: string;
  postalCode: string;
  country: string;
  point: { lat: number; lon: number };
}

export function resolveHouse(body: ResolveHouseRequest): Promise<{ house: House; created: boolean }> {
  return authenticatedFetch("/houses/resolve", { method: "POST", body: JSON.stringify(body) });
}

export function submitClaim(houseId: string): Promise<HouseClaim> {
  return authenticatedFetch("/houses/claims", { method: "POST", body: JSON.stringify({ houseId }) });
}

export function toggleCandyStatus(
  houseId: string,
  body: { status: CandyStatus; publicOptIn?: boolean },
): Promise<CandyParticipation> {
  return authenticatedFetch(`/houses/${houseId}/candy`, { method: "PATCH", body: JSON.stringify(body) });
}

export function fetchMyClaims(): Promise<HouseClaim[]> {
  return authenticatedFetch("/me/claims");
}

export function approveClaim(claimId: string): Promise<HouseClaim> {
  return authenticatedFetch(`/admin/claims/${encodeURIComponent(claimId)}/approve`, { method: "POST" });
}
