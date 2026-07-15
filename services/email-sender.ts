import { GmailEmailSender } from "@/services/gmail-service";
import { SmtpEmailSender } from "@/services/smtp-sender";
import { getSmtpConfig } from "@/services/smtp-service";

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

/** Port every email transport must implement, so swapping mock/Gmail/SMTP is a one-line config change. */
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

/**
 * Resolves the sender for a specific user: their own custom SMTP (webmail)
 * credentials take priority if configured, otherwise falls back to Gmail
 * (when EMAIL_SENDER=gmail) or the mock sender for local/dev use. Sender
 * choice is per-user rather than a single global instance, since different
 * accounts may connect Gmail while others use their own webmail SMTP.
 */
export async function getEmailSenderForUser(userId: string): Promise<EmailSenderPort> {
  const smtpConfig = await getSmtpConfig(userId);
  if (smtpConfig) {
    return new SmtpEmailSender(smtpConfig);
  }

  return process.env.EMAIL_SENDER === "gmail" ? new GmailEmailSender() : new MockEmailSender();
}
