import type { FetchedMessage } from "@/services/imap-service";

export interface OutstandingRecipient {
  id: string;
  sentMessageId: string | null;
}

export interface ReplyResult {
  matchedRecipientId?: string;
}

/**
 * Matches an inbound message back to the campaign send it's replying to,
 * via email threading headers (References, then In-Reply-To) against each
 * outstanding recipient's stored sentMessageId. Threading-header matching
 * is used rather than "any inbound mail from that address counts as a
 * reply", since a lead might separately email you about something
 * unrelated — this only counts a genuine reply to the actual sent message.
 */
export function detectReply(message: FetchedMessage, outstanding: OutstandingRecipient[]): ReplyResult {
  const candidateIds = new Set([...message.references, message.inReplyTo].filter(Boolean) as string[]);

  for (const recipient of outstanding) {
    if (recipient.sentMessageId && candidateIds.has(recipient.sentMessageId)) {
      return { matchedRecipientId: recipient.id };
    }
  }

  return {};
}
