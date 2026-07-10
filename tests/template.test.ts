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

  it("also replaces square-bracket placeholders like [Business Name]", () => {
    expect(renderTemplate("Saw [Business Name] doesn't have a website", "Acme Corp")).toBe(
      "Saw Acme Corp doesn't have a website",
    );
    expect(renderTemplate("Hey [name]!", "Acme Corp")).toBe("Hey Acme Corp!");
  });

  it("leaves unrecognized bracket placeholders untouched", () => {
    expect(renderTemplate("Hi [unknown]", "Acme")).toBe("Hi [unknown]");
  });
});
