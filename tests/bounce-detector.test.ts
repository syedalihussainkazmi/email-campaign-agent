import { describe, it, expect } from "vitest";
import { detectBounce } from "@/services/bounce-detector";

describe("detectBounce", () => {
  it("recognizes a standard DSN-format bounce and extracts the failed recipient", () => {
    const result = detectBounce({
      from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      subject: "Delivery Status Notification (Failure)",
      bodyText:
        "Delivery to the following recipient failed permanently:\n\n" +
        "john@doesnotexist.acme.com\n\n" +
        "Final-Recipient: rfc822; john@doesnotexist.acme.com\n" +
        "Action: failed\n" +
        "Status: 5.1.1",
    });
    expect(result.isBounce).toBe(true);
    expect(result.failedRecipient).toBe("john@doesnotexist.acme.com");
  });

  it("recognizes a 'returned to sender' style bounce", () => {
    const result = detectBounce({
      from: "postmaster@example.com",
      subject: "Undelivered Mail Returned to Sender",
      bodyText: "The original message was received...\n\nFinal-Recipient: rfc822; jane@bad-domain.test",
    });
    expect(result.isBounce).toBe(true);
    expect(result.failedRecipient).toBe("jane@bad-domain.test");
  });

  it("does not flag a normal reply as a bounce", () => {
    const result = detectBounce({
      from: "jim@arborclimb.com.au",
      subject: "Re: Saw your business doesn't have a website yet",
      bodyText: "Thanks for reaching out, yes let's talk.",
    });
    expect(result.isBounce).toBe(false);
    expect(result.failedRecipient).toBeUndefined();
  });

  it("flags a bounce-like subject even without a parseable DSN body, with no recipient extracted", () => {
    const result = detectBounce({
      from: "mailer-daemon@somehost.com",
      subject: "Mail delivery failed: returning message to sender",
      bodyText: "This is a plain-text bounce with no machine-readable recipient field.",
    });
    expect(result.isBounce).toBe(true);
    expect(result.failedRecipient).toBeUndefined();
  });
});
