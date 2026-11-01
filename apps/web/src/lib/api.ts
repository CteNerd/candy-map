/** Local fixtures are used only when no live API is configured. */
import type { CandyParticipation, CandyStatus, EventParticipation, EventStatus, House, HouseClaim, MyHouseClaim, Neighborhood, PolygonGeoJSON, PublicNeighborhood, PublicHousePin, PublicEventPin } from "@candy-map/shared";
import { getEventEdition, getEventLifecycle } from "@candy-map/shared";
import { SEED_HOUSE_PINS, SEED_NEIGHBORHOOD } from "./fixtures";
import { getIdToken } from "../auth/cognito";

const configuredUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_BASE_URL = configuredUrl && import.meta.env.DEV ? "/api" : configuredUrl;
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

export async function fetchNeighborhoodHouses(neighborhoodId: string): Promise<PublicHousePin[]>;
export async function fetchNeighborhoodHouses(neighborhoodId: string, eventId: string): Promise<PublicEventPin[]>;
export async function fetchNeighborhoodHouses(neighborhoodId: string, eventId?: string): Promise<PublicEventPin[]> {
  if (eventId !== undefined) {
    const edition = getEventEdition(eventId);
    if (!edition) throw new Error("Unsupported event edition.");
    if (!API_BASE_URL) {
      return edition.type === "halloween" && getEventLifecycle(edition) === "active" ? SEED_HOUSE_PINS : [];
    }
    return fetchJson<PublicEventPin[]>(`/neighborhoods/${neighborhoodId}/houses?eventId=${encodeURIComponent(eventId)}`);
  }
  if (!API_BASE_URL) return SEED_HOUSE_PINS;
  return fetchJson<PublicHousePin[]>(`/neighborhoods/${neighborhoodId}/houses`);
}

export function isLiveApiConfigured(): boolean {
  return Boolean(API_BASE_URL);
}

// --- Authenticated calls (Milestone 3) -------------------------------------
// These never silently fall back to fixtures — a failed mutation must surface as an error, not a
// misleading fake success.

  export interface PrivacyRequestBody {
    street: string; unit?: string; postalCode: string; country: string;
    mode: "block" | "remove"; message?: string;
  }
  export interface PrivacyRequestEntry {
    id: string; address: string; state: string; mode: "block" | "remove"; message: string; createdAt: string;
  }
  export async function submitPrivacyRequest(body: PrivacyRequestBody): Promise<{ id: string; state: string }> {
    if (!API_BASE_URL) throw new Error("Privacy requests require the live API. Fixture mode cannot remove a property.");
    const response = await fetch(`${API_BASE_URL}/privacy/requests`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      const result = await response.json() as { error?: string };
      throw new Error(result.error ?? `Privacy request failed (${response.status}).`);
    }
    return response.json();
  }
  export const fetchPrivacyRequests = () => authenticatedFetch<PrivacyRequestEntry[]>("/privacy/requests");
  export const resolvePrivacyRequest = (id: string, body: { decision: "approve" | "reject" | "restore"; note: string; authorityConfirmed?: boolean }) =>
    authenticatedFetch(`/privacy/requests/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });

  export interface HouseholdEntry {
    key: string; label: string; role?: "manager" | "editor"; eventId?: string; removable?: boolean;
  }
  export interface HouseholdDetails {
    houseLabel: string; members: HouseholdEntry[]; requests: HouseholdEntry[]; invitations: HouseholdEntry[];
  }
  export const fetchHousehold = (houseId: string, eventId: string) =>
    authenticatedFetch<HouseholdDetails>(`/houses/${encodeURIComponent(houseId)}/household?eventId=${encodeURIComponent(eventId)}`);
  export const createHouseInvitation = (houseId: string, body: { role: "manager" | "editor"; eventId?: string; email?: string }) =>
    authenticatedFetch<{ link: string; expiresAt: string; emailAccepted: boolean; role: string }>(`/houses/${encodeURIComponent(houseId)}/invitations`, { method: "POST", body: JSON.stringify(body) });
  export const acceptHouseInvitation = (token: string) =>
    authenticatedFetch<{ houseLabel: string; role: string; eventId?: string }>("/household/invitations/accept", { method: "POST", body: JSON.stringify({ token }) });
  export const requestHouseAccess = (houseId: string) =>
    authenticatedFetch(`/houses/${encodeURIComponent(houseId)}/access-requests`, { method: "POST" });
  export const householdAction = (houseId: string, body: { key: string; action: string; eventId: string }) =>
    authenticatedFetch(`/houses/${encodeURIComponent(houseId)}/household/actions`, { method: "POST", body: JSON.stringify(body) });
  export const fetchMyNeighborhoods = () => authenticatedFetch<PublicNeighborhood[]>("/me/neighborhoods");
  export const renameNeighborhood = (id: string, name: string) =>
    authenticatedFetch<PublicNeighborhood>(`/neighborhoods/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) });
  export interface OrganizerClaim {
    claimKey: string; houseLabel: string; status: string; createdAt: string;
  }
  export const fetchNeighborhoodClaims = (id: string) =>
    authenticatedFetch<OrganizerClaim[]>(`/neighborhoods/${encodeURIComponent(id)}/claims`);

async function authenticatedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE_URL) throw new Error("VITE_API_BASE_URL not configured");
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

export function fetchMyClaims(eventId?: string): Promise<MyHouseClaim[]> {
  return authenticatedFetch(`/me/claims${eventId === undefined ? "" : `?eventId=${encodeURIComponent(eventId)}`}`);
}

export function updateEventParticipation(houseId: string, eventId: string, body: { status: EventStatus; publicOptIn: boolean }): Promise<EventParticipation> {
  return authenticatedFetch(`/houses/${encodeURIComponent(houseId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH", body: JSON.stringify(body),
  });
}

export function approveClaim(claimId: string): Promise<HouseClaim> {
  return authenticatedFetch(`/admin/claims/${encodeURIComponent(claimId)}/approve`, { method: "POST" });
}

export function createNeighborhood(body: { name: string; polygon: PolygonGeoJSON }): Promise<Neighborhood> {
  return authenticatedFetch("/neighborhoods", { method: "POST", body: JSON.stringify(body) });
}
