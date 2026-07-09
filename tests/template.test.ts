import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/utils/template";

describe("renderTemplate", () => {
  it("replaces {name} with the business name", () => {
    expect(renderTemplate("Hey {name}, quick question", "Acme Corp")).toBe(
      "Hey Acme Corp, quick question",
    );
  });

  it("replaces {business name} regardless of spacing/casing", () => {
    expect(renderTemplate("Hi {Business Name}!", "Beta LLC")).toBe("Hi Beta LLC!");
    expect(renderTemplate("Hi {business_name}!", "Beta LLC")).toBe("Hi Beta LLC!");
  });

  it("leaves unrecognized placeholders untouched", () => {
    expect(renderTemplate("Hi {unknown}", "Acme")).toBe("Hi {unknown}");
  });

  it("replaces multiple occurrences", () => {
    expect(renderTemplate("{name}... yes {name}!", "Acme")).toBe("Acme... yes Acme!");
  });
});
