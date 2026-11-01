import { describe, expect, it } from "vitest";
import { getDefaultEvent, getEventEdition, getEventLifecycle, isEventParticipationVisible } from "../src/events.js";

describe("event editions", () => {
  it("rejects missing, malformed and unsupported editions", () => {
    for (const id of ["", "2026", "christmas-2026", "halloween-9999"]) expect(getEventEdition(id)).toBeUndefined();
  });

  it("uses local midnight boundaries, including daylight-saving changes", () => {
    const christmas = getEventEdition("christmas-lights-2026")!;
    expect(christmas.startsAt).toBe("2026-11-01T05:00:00.000Z");
    expect(christmas.endsAt).toBe("2027-01-07T06:00:00.000Z");
    expect(getEventLifecycle(christmas, new Date("2027-01-07T05:59:59Z"))).toBe("active");
    expect(getEventLifecycle(christmas, new Date(christmas.endsAt))).toBe("past");
    expect(getEventEdition("halloween-2027")!.endsAt).toBe("2027-11-01T05:00:00.000Z");
  });

  it("recommends Christmas after Halloween and keeps the edition across January", () => {
    expect(getDefaultEvent(new Date("2026-11-01T13:00:00Z")).id).toBe("christmas-lights-2026");
    expect(getDefaultEvent(new Date("2027-01-06T20:00:00Z")).id).toBe("christmas-lights-2026");
  });

  it("does not show another edition, invalid activity status, paused, private or expired participation", () => {
    const edition = getEventEdition("christmas-lights-2026")!;
    const now = new Date("2026-12-01T20:00:00Z");
    const participation = {
      houseId: "h1", eventId: edition.id, status: "displaying" as const,
      updatedAt: now.toISOString(), expiresAt: edition.endsAt, publicOptIn: true,
    };
    expect(isEventParticipationVisible(participation, edition, now)).toBe(true);
    expect(isEventParticipationVisible({ ...participation, eventId: "halloween-2026" }, edition, now)).toBe(false);
    expect(isEventParticipationVisible({ ...participation, status: "available" }, edition, now)).toBe(false);
    expect(isEventParticipationVisible({ ...participation, status: "paused" }, edition, now)).toBe(false);
    expect(isEventParticipationVisible({ ...participation, publicOptIn: false }, edition, now)).toBe(false);
    expect(isEventParticipationVisible({ ...participation, expiresAt: now.toISOString() }, edition, now)).toBe(false);
    expect(isEventParticipationVisible(participation, edition, new Date(edition.endsAt))).toBe(false);
  });
});
