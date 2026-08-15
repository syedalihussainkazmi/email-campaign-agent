import { prisma } from "@/database/prisma";
import { dedupeRecipients, type ParsedRecipient } from "@/services/recipient-service";
import { findUnsubscribedEmails } from "@/services/unsubscribe-service";

export interface CreateCampaignInput {
  userId: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  recipients: ParsedRecipient[];
  accountAllocations: { accountId: string; count: number }[]; // today's batch, in order
  // Undefined/null = randomized 5-10s gap (default). A number fixes the gap
  // between sends instead — purely a pacing choice, independent of the
  // daily send caps and multi-day scheduling computed above.
  fixedDelaySeconds?: number;
}

/**
 * Creates a draft campaign. Each recipient's name/owner name is snapshotted
 * directly onto its CampaignRecipient row from exactly what was pasted for
 * THIS campaign — personalization at send time reads that snapshot, never
 * the shared Recipient pool, so an older campaign's name for a reused email
 * address can never silently leak into a later one that didn't specify it.
 * The shared Recipient pool is still updated opportunistically (only when a
 * non-empty value is given) purely as a convenience/dedup record.
 *
 * Each recipient is also assigned a specific SmtpAccount and send day:
 * today's allocation (from the resolved send plan) is flattened into a
 * queue and handed out in order; anything beyond today's capacity is
 * scheduled for a later day against the same account rotation, since the
 * runner re-derives each account's real daily cap every morning via
 * sentToday's rollover.
 */
export async function createCampaign(input: CreateCampaignInput) {
  const deduped = dedupeRecipients(input.recipients);
  const unsubscribed = await findUnsubscribedEmails(
    input.userId,
    deduped.map((r) => r.email),
  );
  const recipients = deduped.filter((r) => !unsubscribed.has(r.email));
  const skippedUnsubscribed = deduped.filter((r) => unsubscribed.has(r.email)).map((r) => r.email);

  const campaign = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        userId: input.userId,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        totalCount: recipients.length,
        fixedDelaySeconds: input.fixedDelaySeconds,
      },
    });

    const accountQueue: string[] = [];
    for (const alloc of input.accountAllocations) {
      for (let i = 0; i < alloc.count; i++) accountQueue.push(alloc.accountId);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < recipients.length; i++) {
      const { email, name, ownerName } = recipients[i];
      const recipient = await tx.recipient.upsert({
        where: { userId_email: { userId: input.userId, email } },
        update: { ...(name ? { name } : {}), ...(ownerName ? { ownerName } : {}) },
        create: { userId: input.userId, email, name, ownerName },
      });

      const isWithinToday = i < accountQueue.length;
      const scheduledFor = isWithinToday
        ? today
        : new Date(today.getTime() + Math.floor(i / Math.max(accountQueue.length, 1)) * 86400000);

      await tx.campaignRecipient.create({
        data: {
          campaignId: campaign.id,
          recipientId: recipient.id,
          name,
          ownerName,
          smtpAccountId: isWithinToday ? accountQueue[i] : accountQueue[i % accountQueue.length],
          scheduledFor,
        },
      });
    }

    return campaign;
  });

  return { campaign, skippedUnsubscribed };
}

export async function listCampaigns(userId: string, page = 1, pageSize = 20) {
  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.campaign.count({ where: { userId } }),
  ]);
  return { items, total, page, pageSize };
}

export async function getCampaignDetail(userId: string, campaignId: string) {
  return prisma.campaign.findFirst({
    where: { id: campaignId, userId },
    include: {
      recipients: {
        include: { recipient: true },
        orderBy: { id: "asc" },
      },
    },
  });
}

export async function getCampaignProgress(userId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
  });
  if (!campaign) return null;

  const currentlySending = await prisma.campaignRecipient.findFirst({
    where: { campaignId, status: "sending" },
    include: { recipient: true },
  });

  return {
    status: campaign.status,
    totalCount: campaign.totalCount,
    sentCount: campaign.sentCount,
    deliveredCount: campaign.deliveredCount,
    failedCount: campaign.failedCount,
    currentRecipient: currentlySending?.recipient.email ?? null,
  };
}

export async function setCampaignControlFlag(
  userId: string,
  campaignId: string,
  flag: "none" | "pause" | "cancel",
) {
  return prisma.campaign.updateMany({
    where: { id: campaignId, userId },
    data: { controlFlag: flag },
  });
}

export async function deleteCampaign(userId: string, campaignId: string) {
  // CampaignRecipient rows cascade-delete automatically (onDelete: Cascade
  // in schema.prisma) — no need to delete them separately first.
  return prisma.campaign.deleteMany({ where: { id: campaignId, userId } });
}
