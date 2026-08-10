export interface InboundMessage {
  from: string;
  subject: string;
  bodyText: string;
}

export interface BounceResult {
  isBounce: boolean;
  failedRecipient?: string;
}

const BOUNCE_SENDER_PATTERN = /mailer-daemon|postmaster|mail delivery subsystem/i;
const BOUNCE_SUBJECT_PATTERN =
  /undelivered|delivery status notification|delivery failed|returned to sender|failure notice/i;
const FINAL_RECIPIENT_PATTERN = /final-recipient:\s*rfc822;\s*([^\s,]+@[^\s,]+)/i;

/**
 * Classifies an inbound message as a bounce notification (or not) and, when
 * the body follows the standard DSN format (RFC 3464's Final-Recipient
 * field), extracts the address that actually failed. Many real-world
 * bounces aren't in strict DSN format, in which case isBounce is still
 * true (the sender/subject pattern is a strong enough signal on its own)
 * but failedRecipient is left undefined rather than guessed at.
 */
export function detectBounce(message: InboundMessage): BounceResult {
  const looksLikeBounce =
    BOUNCE_SENDER_PATTERN.test(message.from) || BOUNCE_SUBJECT_PATTERN.test(message.subject);

  if (!looksLikeBounce) {
    return { isBounce: false };
  }

  const match = message.bodyText.match(FINAL_RECIPIENT_PATTERN);
  return { isBounce: true, failedRecipient: match?.[1] };
}
