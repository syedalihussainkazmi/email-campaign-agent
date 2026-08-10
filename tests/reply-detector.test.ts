import { describe, it, expect } from "vitest";
import { detectReply } from "@/services/reply-detector";

describe("detectReply", () => {
  it("matches a reply via References header against an outstanding sentMessageId", () => {
    const outstanding = [
      { id: "cr1", sentMessageId: "<abc123@mailpilot>" },
      { id: "cr2", sentMessageId: "<def456@mailpilot>" },
    ];
    const message = {
      from: "jim@arborclimb.com.au",
      subject: "Re: quick question",
      bodyText: "Sure, let's talk.",
      references: ["<abc123@mailpilot>"],
      inReplyTo: null,
    };
    expect(detectReply(message, outstanding).matchedRecipientId).toBe("cr1");
  });

  it("matches via In-Reply-To when References is absent", () => {
    const outstanding = [{ id: "cr1", sentMessageId: "<abc123@mailpilot>" }];
    const message = {
      from: "jim@arborclimb.com.au",
      subject: "Re: quick question",
      bodyText: "Sure.",
      references: [],
      inReplyTo: "<abc123@mailpilot>",
    };
    expect(detectReply(message, outstanding).matchedRecipientId).toBe("cr1");
  });

  it("returns no match when neither header lines up with anything outstanding", () => {
    const outstanding = [{ id: "cr1", sentMessageId: "<abc123@mailpilot>" }];
    const message = {
      from: "someone@else.com",
      subject: "Unrelated",
      bodyText: "Hi",
      references: ["<unrelated@somewhere>"],
      inReplyTo: null,
    };
    expect(detectReply(message, outstanding).matchedRecipientId).toBeUndefined();
  });
});
