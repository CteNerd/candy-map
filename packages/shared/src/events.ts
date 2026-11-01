import type { CandyParticipation, GeoPoint } from "./types.js";

export type EventType = "halloween" | "christmas-lights";
export type EventStatus = "available" | "low" | "finished" | "displaying" | "paused";
export type EventLifecycle = "upcoming" | "active" | "past";

export interface EventEdition {
  id: string;
  type: EventType;
  label: string;
  icon: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  statuses: readonly EventStatus[];
}

export interface EventParticipation {
  houseId: string;
  eventId: string;
  status: EventStatus;
  updatedAt: string;
  expiresAt: string;
  publicOptIn: boolean;
}

export interface PublicEventPin {
  id: string;
  point: GeoPoint;
  status: EventStatus;
  updatedAt: string;
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  available: "Available",
  low: "Running low",
  finished: "Finished",
  displaying: "Display listed",
  paused: "Not displaying",
};

// Edition boundaries use an explicit launch-region timezone, not the viewer's clock.
function chicagoMidnight(year: number, month: number, day: number): string {
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let i = 0; i < 2; i++) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((value) => value.type === type)?.value);
    const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    instant += target - local;
  }
  return new Date(instant).toISOString();
}

export function getEventEdition(id: string): EventEdition | undefined {
  const match = /^(halloween|christmas-lights)-(\d{4})$/.exec(id);
  if (!match) return undefined;
  const year = Number(match[2]);
  if (year < 2020 || year > 2100) return undefined;
  if (match[1] === "halloween") {
    return {
      id, type: "halloween", label: `Halloween ${year}`, icon: "🎃",
      timezone: "America/Chicago",
      startsAt: chicagoMidnight(year, 10, 31), endsAt: chicagoMidnight(year, 11, 1),
      statuses: ["available", "low", "finished"],
    };
  }
  return {
    id, type: "christmas-lights", label: `Christmas lights ${year}`, icon: "🎄",
    timezone: "America/Chicago",
    startsAt: chicagoMidnight(year, 11, 1), endsAt: chicagoMidnight(year + 1, 1, 7),
    statuses: ["displaying", "paused"],
  };
}

export function getEventLifecycle(edition: EventEdition, now = new Date()): EventLifecycle {
  if (now.getTime() < Date.parse(edition.startsAt)) return "upcoming";
  return now.getTime() >= Date.parse(edition.endsAt) ? "past" : "active";
}

export function getEventCatalog(now = new Date()): EventEdition[] {
  const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric" }).format(now));
  return [year - 1, year, year + 1].flatMap((value) => {
    const halloween = getEventEdition(`halloween-${value}`);
    const christmas = getEventEdition(`christmas-lights-${value}`);
    return halloween && christmas ? [halloween, christmas] : [];
  });
}

export function getDefaultEvent(now = new Date()): EventEdition {
  const catalog = getEventCatalog(now);
  const active = catalog.find((edition) => getEventLifecycle(edition, now) === "active");
  const upcoming = catalog.find((edition) => getEventLifecycle(edition, now) === "upcoming");
  const edition = active ?? upcoming;
  if (!edition) throw new Error("No supported event edition is available.");
  return edition;
}

export function fromLegacyCandy(participation: CandyParticipation, edition: EventEdition): EventParticipation {
  return {
    houseId: participation.houseId, eventId: edition.id, status: participation.status,
    updatedAt: participation.updatedAt, expiresAt: participation.expiresAt, publicOptIn: participation.publicOptIn,
  };
}

export function isEventParticipationVisible(participation: EventParticipation, edition: EventEdition, now = new Date()): boolean {
  return participation.eventId === edition.id
    && edition.statuses.includes(participation.status)
    && getEventLifecycle(edition, now) === "active"
    && participation.publicOptIn
    && participation.status !== "finished" && participation.status !== "paused"
    && Date.parse(participation.expiresAt) > now.getTime();
}
