import { describe, it, expect } from "vitest";
import { randomDelaySeconds } from "@/utils/delay";

describe("randomDelaySeconds", () => {
  it("stays within the configured bounds", () => {
    for (let i = 0; i < 200; i++) {
      const value = randomDelaySeconds(5, 10);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(10);
    }
  });
});
