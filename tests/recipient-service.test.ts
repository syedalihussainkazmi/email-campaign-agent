import { describe, it, expect } from "vitest";
import { parseRecipients, isValidEmail, dedupeRecipients } from "@/services/recipient-service";

describe("parseRecipients", () => {
  it("extracts bare emails with no name, one per line", () => {
    const result = parseRecipients("john@gmail.com\nalice@gmail.com\nbob@yahoo.com");
    expect(result.valid).toEqual([
      { email: "john@gmail.com", name: "" },
      { email: "alice@gmail.com", name: "" },
      { email: "bob@yahoo.com", name: "" },
    ]);
  });

  it("pairs a business name with an email in various formats", () => {
    const result = parseRecipients(
      "Acme Corp, john@acme.com\njane@beta.com - Beta LLC\nGamma Inc <sam@gamma.com>",
    );
    expect(result.valid).toEqual([
      { email: "john@acme.com", name: "Acme Corp" },
      { email: "jane@beta.com", name: "Beta LLC" },
      { email: "sam@gamma.com", name: "Gamma Inc" },
    ]);
  });

  it("treats a nameless multi-email line as a flat, nameless list", () => {
    const result = parseRecipients("john@gmail.com, alice@gmail.com");
    expect(result.valid).toEqual([
      { email: "john@gmail.com", name: "" },
      { email: "alice@gmail.com", name: "" },
    ]);
  });

  it("applies one business name to every email on the same line", () => {
    const result = parseRecipients(
      "Acme Corp: john@acme.com, sales@acme.com, info@acme.com",
    );
    expect(result.valid).toEqual([
      { email: "john@acme.com", name: "Acme Corp" },
      { email: "sales@acme.com", name: "Acme Corp" },
      { email: "info@acme.com", name: "Acme Corp" },
    ]);
  });

  it("flags duplicates without dropping the first occurrence", () => {
    const result = parseRecipients("a@x.com\na@x.com\nA@X.COM");
    expect(result.valid).toEqual([{ email: "a@x.com", name: "" }]);
    expect(result.duplicates).toHaveLength(2);
  });

  it("flags malformed lines as invalid", () => {
    const result = parseRecipients("not-an-email\nplainname@\n@nodomain.com");
    expect(result.valid).toHaveLength(0);
    expect(result.invalid.length).toBeGreaterThan(0);
  });

  it("normalizes email case", () => {
    const result = parseRecipients("John@Gmail.com");
    expect(result.valid).toEqual([{ email: "john@gmail.com", name: "" }]);
  });
});

describe("isValidEmail", () => {
  it("accepts standard addresses", () => {
    expect(isValidEmail("test@example.com")).toBe(true);
  });

  it("rejects addresses without a TLD", () => {
    expect(isValidEmail("test@example")).toBe(false);
  });
});

describe("dedupeRecipients", () => {
  it("dedupes case-insensitively, keeping the first name seen", () => {
    expect(
      dedupeRecipients([
        { email: "A@b.com", name: "Acme" },
        { email: "a@b.com", name: "" },
      ]),
    ).toEqual([{ email: "a@b.com", name: "Acme" }]);
  });
});
