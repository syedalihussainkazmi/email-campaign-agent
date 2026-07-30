import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/utils/template";

const vars = (businessName: string, ownerName = "") => ({ businessName, ownerName });

describe("renderTemplate", () => {
  it("replaces {name} with the business name", () => {
    expect(renderTemplate("Hey {name}, quick question", vars("Acme Corp"))).toBe(
      "Hey Acme Corp, quick question",
    );
  });

  it("replaces {business name} regardless of spacing/casing", () => {
    expect(renderTemplate("Hi {Business Name}!", vars("Beta LLC"))).toBe("Hi Beta LLC!");
    expect(renderTemplate("Hi {business_name}!", vars("Beta LLC"))).toBe("Hi Beta LLC!");
  });

  it("leaves unrecognized placeholders untouched", () => {
    expect(renderTemplate("Hi {unknown}", vars("Acme"))).toBe("Hi {unknown}");
  });

  it("replaces multiple occurrences", () => {
    expect(renderTemplate("{name}... yes {name}!", vars("Acme"))).toBe("Acme... yes Acme!");
  });

  it("also replaces square-bracket placeholders like [Business Name]", () => {
    expect(renderTemplate("Saw [Business Name] doesn't have a website", vars("Acme Corp"))).toBe(
      "Saw Acme Corp doesn't have a website",
    );
    expect(renderTemplate("Hey [name]!", vars("Acme Corp"))).toBe("Hey Acme Corp!");
  });

  it("leaves unrecognized bracket placeholders untouched", () => {
    expect(renderTemplate("Hi [unknown]", vars("Acme"))).toBe("Hi [unknown]");
  });

  it("replaces {owner name} with the contact's personal name when known", () => {
    expect(renderTemplate("Hey {owner name},", vars("Acme Corp", "Syed Kazmi"))).toBe(
      "Hey Syed Kazmi,",
    );
    expect(renderTemplate("Hey {owner}!", vars("Acme Corp", "Syed Kazmi"))).toBe("Hey Syed Kazmi!");
  });

  it('falls back to "there" for {owner name} when no owner name is known', () => {
    expect(renderTemplate("Hey {owner name},", vars("Acme Corp"))).toBe("Hey there,");
  });

  it("honors an explicit default over the built-in owner fallback", () => {
    expect(renderTemplate("Hey {owner name|friend},", vars("Acme Corp"))).toBe("Hey friend,");
    expect(renderTemplate("Hey {owner name|friend},", vars("Acme Corp", "Syed"))).toBe(
      "Hey Syed,",
    );
  });

  it("supports an explicit default for the business name too", () => {
    expect(renderTemplate("Hi {business name|your business}!", vars(""))).toBe(
      "Hi your business!",
    );
  });
});
