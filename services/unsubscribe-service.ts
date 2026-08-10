import { prisma } from "@/database/prisma";

/**
 * Builds the RFC 2369 / RFC 8058 headers that let Gmail/Yahoo/Outlook show
 * their own built-in one-click "Unsubscribe" button next to the sender
 * name, which is effectively required at any real volume under their 2024
 * bulk-sender rules.
 */
export function buildUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function markUnsubscribed(token: string): Promise<void> {
  await prisma.recipient.updateMany({
    where: { unsubscribeToken: token, unsubscribedAt: null },
    data: { unsubscribedAt: new Date() },
  });
}

/** Emails (lowercased) among `emails` that are already unsubscribed for this user. */
export async function findUnsubscribedEmails(userId: string, emails: string[]): Promise<Set<string>> {
  const rows = await prisma.recipient.findMany({
    where: { userId, email: { in: emails }, unsubscribedAt: { not: null } },
    select: { email: true },
  });
  return new Set(rows.map((r) => r.email));
}
