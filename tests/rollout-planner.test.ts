import { describe, it, expect } from "vitest";
import { planNewRollout } from "@/services/rollout-planner";

describe("planNewRollout", () => {
  it("reaches the target recipient count within its own timeline", () => {
    const plan = planNewRollout(500);
    expect(plan.accountsNeeded).toBeGreaterThanOrEqual(1);
    expect(plan.timeline[plan.timeline.length - 1].cumulativeCapacity).toBeGreaterThanOrEqual(500);
  });

  it("needs at least as many accounts for a much larger target", () => {
    const small = planNewRollout(500);
    const large = planNewRollout(50000);
    expect(large.accountsNeeded).toBeGreaterThanOrEqual(small.accountsNeeded);
  });

  it("derives domainsNeeded from accountsNeeded and mailboxesPerDomain", () => {
    const plan = planNewRollout(50000, { mailboxesPerDomain: 4 });
    expect(plan.domainsNeeded).toBe(Math.ceil(plan.accountsNeeded / 4));
  });

  it("respects an explicit account count instead of searching for the minimum", () => {
    const plan = planNewRollout(1000, { maxAccounts: 3 });
    expect(plan.accountsNeeded).toBe(3);
  });

  it("produces a non-decreasing cumulative capacity timeline", () => {
    const plan = planNewRollout(2000);
    for (let i = 1; i < plan.timeline.length; i++) {
      expect(plan.timeline[i].cumulativeCapacity).toBeGreaterThanOrEqual(
        plan.timeline[i - 1].cumulativeCapacity,
      );
    }
  });
});
