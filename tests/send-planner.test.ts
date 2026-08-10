import { describe, it, expect } from "vitest";
import { buildSendPlan, capForAge, ageInDays } from "@/services/send-planner";

const account = (overrides: Partial<Parameters<typeof buildSendPlan>[1][number]> = {}) => ({
  id: "acc1",
  label: "Main",
  ageDays: 90, // established, cap 100
  dailyCapOverride: undefined,
  sentToday: 0,
  isActive: true,
  ...overrides,
});

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

describe("buildSendPlan", () => {
  it("fits everything in one day across a single established account", () => {
    const plan = buildSendPlan(80, [account()], { hasPersonalization: true });
    expect(plan.estimatedDays).toBe(1);
    expect(plan.allocations).toEqual([{ accountId: "acc1", label: "Main", count: 80 }]);
    expect(plan.warnings).toEqual([]);
  });

  it("splits across multiple accounts respecting each one's remaining cap", () => {
    const accounts = [
      account({ id: "a", label: "A", ageDays: 1 }), // cap 10
      account({ id: "b", label: "B", ageDays: 10 }), // cap 25
    ];
    const plan = buildSendPlan(30, accounts, { hasPersonalization: true });
    expect(plan.estimatedDays).toBe(1);
    expect(plan.allocations).toEqual([
      { accountId: "b", label: "B", count: 25 },
      { accountId: "a", label: "A", count: 5 },
    ]);
  });

  it("accounts for what's already been sent today", () => {
    const accounts = [account({ sentToday: 90 })]; // established cap 100, 10 left
    const plan = buildSendPlan(10, accounts, { hasPersonalization: true });
    expect(plan.allocations).toEqual([{ accountId: "acc1", label: "Main", count: 10 }]);
    expect(plan.estimatedDays).toBe(1);
  });

  it("spreads across multiple days when total capacity is exceeded", () => {
    const plan = buildSendPlan(250, [account()], { hasPersonalization: true }); // cap 100/day
    expect(plan.estimatedDays).toBe(3);
    expect(plan.warnings.some((w) => w.includes("3 days"))).toBe(true);
  });

  it("warns when zero accounts are active", () => {
    const plan = buildSendPlan(10, [], { hasPersonalization: true });
    expect(plan.warnings.some((w) => w.includes("no active"))).toBe(true);
    expect(plan.allocations).toEqual([]);
  });

  it("warns when the template has no personalization tokens", () => {
    const plan = buildSendPlan(50, [account()], { hasPersonalization: false });
    expect(plan.warnings.some((w) => w.toLowerCase().includes("personalization"))).toBe(true);
  });

  it("ignores inactive accounts entirely", () => {
    const accounts = [account({ isActive: false }), account({ id: "b", label: "B" })];
    const plan = buildSendPlan(10, accounts, { hasPersonalization: true });
    expect(plan.allocations).toEqual([{ accountId: "b", label: "B", count: 10 }]);
  });
});
