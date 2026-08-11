import { describe, it, expect } from "vitest";
import { isWithinSendingWindow } from "@/services/sending-window-service";

const window = { startHour: 9, endHour: 17, timezone: "UTC", sendOnWeekends: false };

describe("isWithinSendingWindow", () => {
  it("allows sending during business hours on a weekday", () => {
    // 2026-08-04 is a Tuesday
    expect(isWithinSendingWindow(new Date("2026-08-04T12:00:00Z"), window)).toBe(true);
  });

  it("blocks sending outside business hours", () => {
    expect(isWithinSendingWindow(new Date("2026-08-04T03:00:00Z"), window)).toBe(false);
  });

  it("blocks weekends when sendOnWeekends is false", () => {
    // 2026-08-08 is a Saturday
    expect(isWithinSendingWindow(new Date("2026-08-08T12:00:00Z"), window)).toBe(false);
  });

  it("allows weekends when sendOnWeekends is true", () => {
    expect(isWithinSendingWindow(new Date("2026-08-08T12:00:00Z"), { ...window, sendOnWeekends: true })).toBe(
      true,
    );
  });

  it("respects a non-UTC timezone", () => {
    // 2026-08-04T20:00:00Z = 2026-08-05 06:00 AEST - before the 9am start in that zone
    const aestWindow = { ...window, timezone: "Australia/Brisbane" };
    expect(isWithinSendingWindow(new Date("2026-08-04T20:00:00Z"), aestWindow)).toBe(false);
  });

  it("endHour=24 covers the 11pm hour through midnight; endHour=23 does not", () => {
    // 2026-08-04T23:30:00Z is a Tuesday, 23:30 UTC
    const almostMidnight = new Date("2026-08-04T23:30:00Z");
    expect(isWithinSendingWindow(almostMidnight, { ...window, startHour: 0, endHour: 23 })).toBe(false);
    expect(isWithinSendingWindow(almostMidnight, { ...window, startHour: 0, endHour: 24 })).toBe(true);
  });
});
