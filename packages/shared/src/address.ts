/**
 * Address normalization and canonical-key derivation.
 *
 * Per COPILOT_PLAN.md "House duplicate prevention": canonical key = provider-standardized address
 * identifier when available; fallback to normalized street address + unit + postal code + country.
 * Never use raw lat/lon alone as the unique identity.
 *
 * Deliberately avoids `node:crypto` here: this package is bundled into the browser (web app) as
 * well as the Lambda handlers, and the fallback key only needs to be a stable, collision-resistant
 * dedupe key — not a cryptographic hash.
 */

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
 * Deterministic, dependency-free 64-bit FNV-1a hash, rendered as hex. Not cryptographic — only
 * used to turn a normalized composite address string into a fixed-length dedupe key.
 */
function fnv1aHash(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask64 = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask64;
  }
  return hash.toString(16).padStart(16, "0");
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
  return `fallback:${fnv1aHash(composite)}`;
}
