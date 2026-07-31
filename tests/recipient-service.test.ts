import { describe, it, expect } from "vitest";
import { parseRecipients, isValidEmail, dedupeRecipients } from "@/services/recipient-service";

describe("parseRecipients", () => {
  it("extracts bare emails with no name, one per line", () => {
    const result = parseRecipients("john@gmail.com\nalice@gmail.com\nbob@yahoo.com");
    expect(result.valid).toEqual([
      { email: "john@gmail.com", name: "", ownerName: "" },
      { email: "alice@gmail.com", name: "", ownerName: "" },
      { email: "bob@yahoo.com", name: "", ownerName: "" },
    ]);
  });

  it("pairs a business name with an email in various formats", () => {
    const result = parseRecipients(
      "Acme Corp, john@acme.com\njane@beta.com - Beta LLC\nGamma Inc <sam@gamma.com>",
    );
    expect(result.valid).toEqual([
      { email: "john@acme.com", name: "Acme Corp", ownerName: "" },
      { email: "jane@beta.com", name: "Beta LLC", ownerName: "" },
      { email: "sam@gamma.com", name: "Gamma Inc", ownerName: "" },
    ]);
  });

  it("treats a nameless multi-email line as a flat, nameless list", () => {
    const result = parseRecipients("john@gmail.com, alice@gmail.com");
    expect(result.valid).toEqual([
      { email: "john@gmail.com", name: "", ownerName: "" },
      { email: "alice@gmail.com", name: "", ownerName: "" },
    ]);
  });

  it("applies one business name to every email on the same line", () => {
    const result = parseRecipients("Acme Corp: john@acme.com, sales@acme.com, info@acme.com");
    expect(result.valid).toEqual([
      { email: "john@acme.com", name: "Acme Corp", ownerName: "" },
      { email: "sales@acme.com", name: "Acme Corp", ownerName: "" },
      { email: "info@acme.com", name: "Acme Corp", ownerName: "" },
    ]);
  });

  it("extracts an owner/contact name as a second dash-separated segment", () => {
    const result = parseRecipients("DevXtech - Syed Kazmi - sk@devxtech.com");
    expect(result.valid).toEqual([
      { email: "sk@devxtech.com", name: "DevXtech", ownerName: "Syed Kazmi" },
    ]);
  });

  it("applies the shared business + owner name to every email on the line", () => {
    const result = parseRecipients("DevXtech - Syed Kazmi - sk@devxtech.com, sales@devxtech.com");
    expect(result.valid).toEqual([
      { email: "sk@devxtech.com", name: "DevXtech", ownerName: "Syed Kazmi" },
      { email: "sales@devxtech.com", name: "DevXtech", ownerName: "Syed Kazmi" },
    ]);
  });

  it("splits the owner name even without a space before the dash", () => {
    const result = parseRecipients("DevXtech- Syed Kazmi - sk@devxtech.com");
    expect(result.valid).toEqual([
      { email: "sk@devxtech.com", name: "DevXtech", ownerName: "Syed Kazmi" },
    ]);
  });

  it("does not split a genuinely hyphenated business name with no owner", () => {
    const result = parseRecipients("Coca-Cola, john@coca-cola.com");
    expect(result.valid).toEqual([
      { email: "john@coca-cola.com", name: "Coca-Cola", ownerName: "" },
    ]);
  });

  it("flags duplicates without dropping the first occurrence", () => {
    const result = parseRecipients("a@x.com\na@x.com\nA@X.COM");
    expect(result.valid).toEqual([{ email: "a@x.com", name: "", ownerName: "" }]);
    expect(result.duplicates).toHaveLength(2);
  });

  it("flags malformed lines as invalid", () => {
    const result = parseRecipients("not-an-email\nplainname@\n@nodomain.com");
    expect(result.valid).toHaveLength(0);
    expect(result.invalid.length).toBeGreaterThan(0);
  });

  it("normalizes email case", () => {
    const result = parseRecipients("John@Gmail.com");
    expect(result.valid).toEqual([{ email: "john@gmail.com", name: "", ownerName: "" }]);
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
        { email: "A@b.com", name: "Acme", ownerName: "Syed" },
        { email: "a@b.com", name: "", ownerName: "" },
      ]),
    ).toEqual([{ email: "a@b.com", name: "Acme", ownerName: "Syed" }]);
  });
});
