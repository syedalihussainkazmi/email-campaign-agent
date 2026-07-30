import { prisma } from "@/database/prisma";
import { dedupeRecipients, type ParsedRecipient } from "@/services/recipient-service";

export interface CreateCampaignInput {
  userId: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  recipients: ParsedRecipient[];
}

/**
 * Creates a draft campaign. Each recipient's name/owner name is snapshotted
 * directly onto its CampaignRecipient row from exactly what was pasted for
 * THIS campaign — personalization at send time reads that snapshot, never
 * the shared Recipient pool, so an older campaign's name for a reused email
 * address can never silently leak into a later one that didn't specify it.
 * The shared Recipient pool is still updated opportunistically (only when a
 * non-empty value is given) purely as a convenience/dedup record.
 */
export async function createCampaign(input: CreateCampaignInput) {
  const recipients = dedupeRecipients(input.recipients);

  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        userId: input.userId,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        totalCount: recipients.length,
      },
    });

    for (const { email, name, ownerName } of recipients) {
      const recipient = await tx.recipient.upsert({
        where: { userId_email: { userId: input.userId, email } },
        update: { ...(name ? { name } : {}), ...(ownerName ? { ownerName } : {}) },
        create: { userId: input.userId, email, name, ownerName },
      });

      await tx.campaignRecipient.create({
        data: { campaignId: campaign.id, recipientId: recipient.id, name, ownerName },
      });
    }

    return campaign;
  });
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
