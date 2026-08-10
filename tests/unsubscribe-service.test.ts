import { describe, it, expect } from "vitest";
import { buildUnsubscribeHeaders } from "@/services/unsubscribe-service";

describe("buildUnsubscribeHeaders", () => {
  it("includes both the https link and List-Unsubscribe-Post for one-click support", () => {
    const headers = buildUnsubscribeHeaders("https://mailpilot.example/api/unsubscribe/abc123");
    expect(headers["List-Unsubscribe"]).toBe("<https://mailpilot.example/api/unsubscribe/abc123>");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
