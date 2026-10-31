import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "../src/lib/time";

describe("formatRelativeTime", () => {
  const now = new Date("2024-10-31T22:30:00.000Z");

  it("reports just now for sub-minute differences", () => {
    expect(formatRelativeTime("2024-10-31T22:29:45.000Z", now)).toBe("just now");
  });

  it("reports singular minute", () => {
    expect(formatRelativeTime("2024-10-31T22:29:00.000Z", now)).toBe("1 min ago");
  });

  it("reports plural minutes", () => {
    expect(formatRelativeTime("2024-10-31T22:15:00.000Z", now)).toBe("15 min ago");
  });

  it("reports singular hour", () => {
    expect(formatRelativeTime("2024-10-31T21:30:00.000Z", now)).toBe("1 hr ago");
  });

  it("reports plural hours", () => {
    expect(formatRelativeTime("2024-10-31T19:30:00.000Z", now)).toBe("3 hrs ago");
  });
});
