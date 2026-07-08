import { describe, it, expect } from "vitest";
import { parseRecipients, isValidEmail, dedupeEmails } from "@/services/recipient-service";

describe("parseRecipients", () => {
  it("extracts valid emails from mixed free-form text", () => {
    const result = parseRecipients("john@gmail.com, alice@gmail.com\nbob@yahoo.com");
    expect(result.valid).toEqual(["john@gmail.com", "alice@gmail.com", "bob@yahoo.com"]);
  });

  it("flags duplicates without dropping the first occurrence", () => {
    const result = parseRecipients("a@x.com a@x.com A@X.COM");
    expect(result.valid).toEqual(["a@x.com"]);
    expect(result.duplicates).toHaveLength(2);
  });

  it("flags malformed tokens as invalid", () => {
    const result = parseRecipients("not-an-email plainname@ @nodomain.com");
    expect(result.valid).toHaveLength(0);
    expect(result.invalid.length).toBeGreaterThan(0);
  });

  it("normalizes case", () => {
    const result = parseRecipients("John@Gmail.com");
    expect(result.valid).toEqual(["john@gmail.com"]);
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

describe("dedupeEmails", () => {
  it("dedupes case-insensitively", () => {
    expect(dedupeEmails(["A@b.com", "a@b.com"])).toEqual(["a@b.com"]);
  });
});
