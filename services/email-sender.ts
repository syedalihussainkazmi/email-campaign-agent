import { SmtpEmailSender } from "@/services/smtp-sender";
import { getSmtpAccountWithPassword } from "@/services/smtp-service";

export interface OutgoingEmail {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

/** Port every email transport must implement. */
export interface EmailSenderPort {
  send(userId: string, message: OutgoingEmail): Promise<SendResult>;
}

/** Resolves the sender for one specific SmtpAccount — a campaign's recipients may span several. */
export async function getEmailSenderForAccount(accountId: string, userId: string): Promise<EmailSenderPort> {
  const account = await getSmtpAccountWithPassword(accountId, userId);
  if (!account) throw new Error(`SMTP account ${accountId} not found for this user`);

  return new SmtpEmailSender({
    host: account.host,
    port: account.port,
    secure: account.secure,
    username: account.username,
    password: account.password,
    fromEmail: account.fromEmail,
  });
}
