import nodemailer from "nodemailer";
import type { EmailSenderPort, OutgoingEmail, SendResult } from "@/services/email-sender";

/** The minimal connection details needed to actually send/verify — a subset of SmtpAccountInput. */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
}

/** Sends via any standard SMTP account (cPanel, Zoho Mail, Titan, custom domain webmail, etc). */
export class SmtpEmailSender implements EmailSenderPort {
  constructor(private readonly config: SmtpConfig) {}

  async send(_userId: string, message: OutgoingEmail): Promise<SendResult> {
    try {
      const transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: { user: this.config.username, pass: this.config.password },
      });

      const info = await transporter.sendMail({
        from: this.config.fromEmail,
        to: message.to,
        subject: message.subject,
        html: message.bodyHtml,
        text: message.bodyText,
      });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown SMTP error" };
    }
  }
}

/** Verifies SMTP credentials by opening a connection without sending anything. */
export async function verifySmtpConfig(config: SmtpConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: config.password },
    });
    await transporter.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown SMTP error" };
  }
}
