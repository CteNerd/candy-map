/** Local fixtures are used only when no live API is configured. */
import type { CandyParticipation, CandyStatus, House, HouseClaim, PublicNeighborhood, PublicHousePin } from "@candy-map/shared";
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

export async function fetchNeighborhoodsNear(lat: number, lon: number): Promise<PublicNeighborhood[]> {
  if (!API_BASE_URL) return [SEED_NEIGHBORHOOD];
  return fetchJson<PublicNeighborhood[]>(`/neighborhoods?lat=${lat}&lon=${lon}`);
}

export async function fetchNeighborhoodHouses(neighborhoodId: string): Promise<PublicHousePin[]> {
  if (!API_BASE_URL) return SEED_HOUSE_PINS;
  return fetchJson<PublicHousePin[]>(`/neighborhoods/${neighborhoodId}/houses`);
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
