import { prisma } from "@/database/prisma";
import { fetchMessagesSince } from "@/services/imap-service";
import { detectBounce } from "@/services/bounce-detector";
import { detectReply } from "@/services/reply-detector";
import { getSmtpAccountWithPassword } from "@/services/smtp-service";

/**
 * Polls every IMAP-configured account for new inbox messages since its last
 * check, classifies each as a bounce or reply, and updates the matching
 * CampaignRecipient row. Meant to be triggered periodically by an external
 * ping (see app/api/campaigns/poll-inbox/route.ts) — same constraint as the
 * multi-day campaign resume in Task 9.
 */
export async function pollAllInboxes(): Promise<{ checked: number; bounces: number; replies: number }> {
  const accounts = await prisma.smtpAccount.findMany({
    where: { imapHost: { not: null }, isActive: true },
  });

  let bounces = 0;
  let replies = 0;

  for (const account of accounts) {
    const full = await getSmtpAccountWithPassword(account.id, account.userId);
    if (!full || !full.imapHost) continue;

    const since = account.lastInboxCheckAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const messages = await fetchMessagesSince(
      {
        host: full.imapHost,
        port: full.imapPort,
        secure: full.imapSecure,
        username: full.username,
        password: full.password,
      },
      since,
    );

    for (const message of messages) {
      const bounce = detectBounce(message);
      if (bounce.isBounce && bounce.failedRecipient) {
        const matches = await prisma.campaignRecipient.findMany({
          where: {
            smtpAccountId: account.id,
            status: "sent",
            bouncedAt: null,
            recipient: { email: bounce.failedRecipient },
          },
          select: { id: true, campaignId: true },
        });

        for (const match of matches) {
          await prisma.campaignRecipient.update({
            where: { id: match.id },
            data: { bouncedAt: new Date(), bounceReason: "Bounced (detected via inbox scan)" },
          });
          await prisma.campaign.update({
            where: { id: match.campaignId },
            data: { bouncedCount: { increment: 1 } },
          });
          bounces++;
        }
        continue;
      }

      const outstanding = await prisma.campaignRecipient.findMany({
        where: { smtpAccountId: account.id, status: "sent", sentMessageId: { not: null } },
        select: { id: true, sentMessageId: true, campaignId: true },
      });
      const reply = detectReply(message, outstanding);
      if (reply.matchedRecipientId) {
        const matched = outstanding.find((r) => r.id === reply.matchedRecipientId)!;
        await prisma.campaignRecipient.update({
          where: { id: matched.id },
          data: { repliedAt: new Date() },
        });
        await prisma.campaign.update({
          where: { id: matched.campaignId },
          data: { repliedCount: { increment: 1 } },
        });
        replies++;
      }
    }

    await prisma.smtpAccount.update({
      where: { id: account.id },
      data: { lastInboxCheckAt: new Date() },
    });
  }

  return { checked: accounts.length, bounces, replies };
}
