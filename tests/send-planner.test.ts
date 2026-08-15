import { describe, it, expect } from "vitest";
import {
  capForAge,
  ageInDays,
  projectAccountCapacityTimeline,
  estimateSendSeconds,
  formatDuration,
} from "@/services/send-planner";

describe("capForAge", () => {
  it("follows the ramp schedule as the account gets older", () => {
    expect(capForAge(0)).toBe(10);
    expect(capForAge(3)).toBe(10);
    expect(capForAge(4)).toBe(25);
    expect(capForAge(14)).toBe(25);
    expect(capForAge(15)).toBe(50);
    expect(capForAge(29)).toBe(50);
    expect(capForAge(30)).toBe(75);
    expect(capForAge(59)).toBe(75);
    expect(capForAge(60)).toBe(100);
    expect(capForAge(365)).toBe(100);
  });
});

describe("ageInDays", () => {
  it("computes whole days elapsed since a given date", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    expect(ageInDays(tenDaysAgo)).toBe(10);
  });
});

describe("projectAccountCapacityTimeline", () => {
  it("grows daily capacity as an account ages into the next ramp bracket", () => {
    const accounts = [
      { id: "a", label: "A", ageDays: 0, dailyCapOverride: undefined, sentToday: 0, isActive: true },
    ];
    const projection = projectAccountCapacityTimeline(accounts, 100000, 10);
    expect(projection.dailyCapacityByDay[0]).toBe(10); // today, age 0 -> cap 10
    expect(projection.dailyCapacityByDay[4]).toBe(25); // 4 days from now, age 4 -> cap 25
  });

  it("reports days until enough cumulative capacity to clear the list", () => {
    const accounts = [
      { id: "a", label: "A", ageDays: 90, dailyCapOverride: undefined, sentToday: 0, isActive: true },
    ];
    const projection = projectAccountCapacityTimeline(accounts, 250, 10);
    expect(projection.daysToClear).toBe(3); // 100+100+100=300 >= 250 by the 3rd day
  });

  it("returns null when the horizon isn't long enough to clear the list", () => {
    const accounts = [
      { id: "a", label: "A", ageDays: 90, dailyCapOverride: undefined, sentToday: 0, isActive: true },
    ];
    const projection = projectAccountCapacityTimeline(accounts, 100000, 5);
    expect(projection.daysToClear).toBeNull();
  });

  it("ignores inactive accounts", () => {
    const accounts = [
      { id: "a", label: "A", ageDays: 90, dailyCapOverride: undefined, sentToday: 0, isActive: false },
      { id: "b", label: "B", ageDays: 90, dailyCapOverride: undefined, sentToday: 0, isActive: true },
    ];
    const projection = projectAccountCapacityTimeline(accounts, 50, 5);
    expect(projection.dailyCapacityByDay[0]).toBe(100); // only B counted
  });
});

describe("estimateSendSeconds", () => {
  it("uses a flat 5s gap for fixed pace", () => {
    // 10 recipients = 9 gaps between them
    expect(estimateSendSeconds(10, true)).toBe(45);
  });

  it("uses the 7.5s midpoint of the randomized 5-10s gap otherwise", () => {
    expect(estimateSendSeconds(10, false)).toBe(68); // round(9 * 7.5) = 68
  });

  it("returns 0 for a single recipient (no gap needed) or none", () => {
    expect(estimateSendSeconds(1, true)).toBe(0);
    expect(estimateSendSeconds(0, true)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats sub-hour durations as minutes", () => {
    expect(formatDuration(600)).toBe("10m");
  });

  it("formats hour-plus durations as hours and minutes", () => {
    expect(formatDuration(5400)).toBe("1h 30m");
  });

  it("omits minutes when they round to zero", () => {
    expect(formatDuration(3600)).toBe("1h");
  });
});
