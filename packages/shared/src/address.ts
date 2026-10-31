/**
 * Address normalization and canonical-key derivation.
 *
 * Per COPILOT_PLAN.md "House duplicate prevention": canonical key = provider-standardized address
 * identifier when available; fallback to normalized street address + unit + postal code + country.
 * Never use raw lat/lon alone as the unique identity.
 */

import { createHash } from "node:crypto";

export interface ParsedAddress {
  street: string;
  unit?: string;
  postalCode: string;
  country: string;
}

const WHITESPACE = /\s+/g;

const STREET_SUFFIX_EXPANSIONS: Record<string, string> = {
  st: "street",
  rd: "road",
  ave: "avenue",
  blvd: "boulevard",
  dr: "drive",
  ln: "lane",
  ct: "court",
  pl: "place",
  ter: "terrace",
  cir: "circle",
  hwy: "highway",
  pkwy: "parkway",
};

const DIRECTIONAL_EXPANSIONS: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

function normalizeToken(token: string): string {
  const bare = token.replace(/\./g, "").toLowerCase();
  return STREET_SUFFIX_EXPANSIONS[bare] ?? DIRECTIONAL_EXPANSIONS[bare] ?? bare;
}

/**
 * Normalizes a street string into a stable comparable form: lowercase, expanded common
 * abbreviations (St -> Street, N -> North, etc.), collapsed whitespace, punctuation stripped.
 */
export function normalizeStreet(street: string): string {
  return street
    .trim()
    .replace(/[,#]/g, " ")
    .split(WHITESPACE)
    .filter(Boolean)
    .map(normalizeToken)
    .join(" ");
}

export function normalizeUnit(unit: string | undefined | null): string | undefined {
  if (!unit) return undefined;
  const normalized = unit.trim().toLowerCase().replace(/^(apt|unit|#|suite|ste)\.?\s*/i, "");
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizePostalCode(postalCode: string): string {
  // Keep only the primary 5-digit segment for US ZIP+4; otherwise just collapse whitespace/case.
  const trimmed = postalCode.trim().toUpperCase();
  const usZip = trimmed.match(/^(\d{5})(-\d{4})?$/);
  return usZip ? usZip[1]! : trimmed.replace(WHITESPACE, "");
}

export function normalizeCountry(country: string): string {
  return country.trim().toUpperCase();
}

export function normalizeAddress(input: {
  street: string;
  unit?: string | null;
  postalCode: string;
  country: string;
}): ParsedAddress {
  const unit = normalizeUnit(input.unit);
  const parsed: ParsedAddress = {
    street: normalizeStreet(input.street),
    postalCode: normalizePostalCode(input.postalCode),
    country: normalizeCountry(input.country),
  };
  if (unit !== undefined) {
    parsed.unit = unit;
  }
  return parsed;
}

/**
 * Derives the canonical house identity key. If a geocoding provider gives us a stable
 * standardized address identifier (e.g. a place ID), prefer that — it's passed through verbatim
 * with a `provider:` prefix so it can never collide with the fallback composite key. Otherwise
 * falls back to a hash of the normalized street + unit + postal code + country.
 */
export function canonicalAddressKey(input: {
  providerAddressId?: string | null;
  street: string;
  unit?: string | null;
  postalCode: string;
  country: string;
}): string {
  if (input.providerAddressId) {
    return `provider:${input.providerAddressId}`;
  }
  const normalized = normalizeAddress(input);
  const composite = [normalized.street, normalized.unit ?? "", normalized.postalCode, normalized.country].join(
    "|",
  );
  const hash = createHash("sha256").update(composite).digest("hex").slice(0, 32);
  return `fallback:${hash}`;
}
