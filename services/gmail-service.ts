import { google } from "googleapis";
import { prisma } from "@/database/prisma";
import { encryptToken, decryptToken } from "@/services/token-service";
import type { EmailSenderPort, OutgoingEmail, SendResult } from "@/services/email-sender";

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
}

/** Refreshes an expired Gmail access token and persists the new encrypted value. */
async function ensureFreshAccessToken(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google", disconnectedAt: null },
  });
  if (!account?.refresh_token) {
    throw new Error("Gmail account not connected");
  }

  const isExpired = !account.expires_at || account.expires_at * 1000 < Date.now() + 60_000;
  if (!isExpired && account.access_token) {
    return decryptToken(account.access_token);
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ refresh_token: decryptToken(account.refresh_token) });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: credentials.access_token ? encryptToken(credentials.access_token) : null,
        expires_at: credentials.expiry_date ? Math.floor(credentials.expiry_date / 1000) : null,
      },
    });
    return credentials.access_token ?? "";
  } catch {
    // Refresh failing usually means the user revoked access in their Google account.
    await prisma.account.update({
      where: { id: account.id },
      data: { disconnectedAt: new Date() },
    });
    throw new Error("Gmail permission revoked, please reconnect");
  }
}

function buildRawMessage(to: string, subject: string, bodyHtml: string): string {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    bodyHtml,
  ].join("\n");

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Real Gmail API sender. Inactive until EMAIL_SENDER=gmail and OAuth credentials are configured. */
export class GmailEmailSender implements EmailSenderPort {
  async send(userId: string, message: OutgoingEmail): Promise<SendResult> {
    try {
      const accessToken = await ensureFreshAccessToken(userId);
      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials({ access_token: accessToken });

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: buildRawMessage(message.to, message.subject, message.bodyHtml) },
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown Gmail error" };
    }
  }
}
