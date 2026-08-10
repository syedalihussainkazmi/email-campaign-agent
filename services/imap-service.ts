import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface FetchedMessage {
  from: string;
  subject: string;
  bodyText: string;
  references: string[];
  inReplyTo: string | null;
}

/**
 * Connects to an account's inbox and returns every message received since
 * `since`. Opens and closes the connection per call — this runs on a slow
 * poll cadence (every few minutes at most), not per-recipient, so
 * connection reuse isn't worth the complexity here.
 */
export async function fetchMessagesSince(
  config: { host: string; port: number; secure: boolean; username: string; password: string },
  since: Date,
): Promise<FetchedMessage[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
    logger: false,
  });

  const messages: FetchedMessage[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch({ since }, { source: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        messages.push({
          from: parsed.from?.text ?? "",
          subject: parsed.subject ?? "",
          bodyText: parsed.text ?? "",
          references: Array.isArray(parsed.references)
            ? parsed.references
            : parsed.references
              ? [parsed.references]
              : [],
          inReplyTo: parsed.inReplyTo ?? null,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return messages;
}
