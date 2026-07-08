import { describe, it, expect } from "vitest";
import { scoreSpamRisk } from "@/agents/spam-score";

describe("scoreSpamRisk", () => {
  it("scores clean copy near zero", () => {
    const { score } = scoreSpamRisk("Monthly update", "Here's what's new this month.");
    expect(score).toBe(0);
  });

  it("flags trigger words and shouting subjects", () => {
    const { score, hints } = scoreSpamRisk("FREE CASH GUARANTEE!!!!", "Act now, click here!");
    expect(score).toBeGreaterThan(30);
    expect(hints.length).toBeGreaterThan(0);
  });
});
