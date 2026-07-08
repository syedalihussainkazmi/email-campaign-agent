import { GmailEmailSender } from "@/services/gmail-service";

export interface OutgoingEmail {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
}

/** Port every email transport must implement, so swapping mock/real Gmail is a one-line config change. */
export interface EmailSenderPort {
  send(userId: string, message: OutgoingEmail): Promise<SendResult>;
}

/**
 * Default sender for local/dev use when no Gmail OAuth credentials are
 * configured yet. Simulates network latency and an occasional failure so
 * the UI/progress flow can be exercised end-to-end.
 */
export class MockEmailSender implements EmailSenderPort {
  async send(_userId: string, message: OutgoingEmail): Promise<SendResult> {
    await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));

    if (!message.to.includes("@")) {
      return { success: false, error: "Invalid recipient address" };
    }

    return { success: true };
  }
}

let cachedSender: EmailSenderPort | null = null;

/** Resolves the active sender implementation based on EMAIL_SENDER env var. */
export function getEmailSender(): EmailSenderPort {
  if (cachedSender) return cachedSender;

  cachedSender =
    process.env.EMAIL_SENDER === "gmail" ? new GmailEmailSender() : new MockEmailSender();

  return cachedSender;
}
