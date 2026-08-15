"use server";

import { z } from "zod";
import { requireSession } from "@/auth/session";
import { createCampaign, setCampaignControlFlag, deleteCampaign } from "@/services/campaign-service";
import { logAudit } from "@/services/audit-service";
import { startCampaignRunner } from "@/server/campaign-runner";
import { isRateLimited } from "@/server/rate-limiter";
import { listSmtpAccounts } from "@/services/smtp-service";
import { capForAge, toPlannerAccount, projectAccountCapacityTimeline } from "@/services/send-planner";
import { planNewRollout } from "@/services/rollout-planner";
import { prisma } from "@/database/prisma";

const createCampaignSchema = z.object({
  subject: z.string().min(1).max(300),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  recipients: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().default(""),
        ownerName: z.string().default(""),
      }),
    )
    .min(1),
  accountId: z.string().min(1, "Select an email account to send from"),
  dailyCap: z.number().int().min(1, "Enter how many to send per day"),
  useFixedPace: z.boolean().default(false),
});

export async function createAndStartCampaignAction(input: z.infer<typeof createCampaignSchema>) {
  const session = await requireSession();
  if (isRateLimited(`create-campaign:${session.user.id}`)) {
    throw new Error("Too many campaigns started, please slow down");
  }

  const parsed = createCampaignSchema.parse(input);

  // Re-verify the chosen account actually belongs to this user — never trust
  // the client-supplied accountId on its own.
  const allAccounts = await listSmtpAccounts(session.user.id);
  const account = allAccounts.find((a) => a.id === parsed.accountId);
  if (!account) {
    throw new Error("Selected email account not found");
  }

  const { campaign, skippedUnsubscribed } = await createCampaign({
    userId: session.user.id,
    subject: parsed.subject,
    bodyHtml: parsed.bodyHtml,
    bodyText: parsed.bodyText,
    recipients: parsed.recipients,
    accountAllocations: [{ accountId: parsed.accountId, count: parsed.dailyCap }],
    fixedDelaySeconds: parsed.useFixedPace ? 5 : undefined,
  });

  // Bookkeeping only — the schedule itself was already fully decided above.
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { smtpAccountId: parsed.accountId, dailyCap: parsed.dailyCap },
  });

  await logAudit(session.user.id, "campaign.create", { type: "campaign", id: campaign.id });

  void startCampaignRunner(campaign.id);

  return { campaignId: campaign.id, skippedUnsubscribed };
}

export async function listAccountsForPlanningAction() {
  const session = await requireSession();
  return listSmtpAccounts(session.user.id);
}

const suggestedCapSchema = z.object({ accountId: z.string().min(1) });

/** Pure informational suggestion — never applied automatically. */
export async function getSuggestedDailyCapAction(input: z.infer<typeof suggestedCapSchema>) {
  const session = await requireSession();
  const { accountId } = suggestedCapSchema.parse(input);
  const accounts = await listSmtpAccounts(session.user.id);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;
  const planner = toPlannerAccount(account);
  return {
    ageDays: planner.ageDays,
    suggestedDailyCap: planner.dailyCapOverride ?? capForAge(planner.ageDays),
  };
}

const rolloutPlanSchema = z.object({ totalRecipients: z.number().int().min(1) });

export async function planRolloutAction(input: z.infer<typeof rolloutPlanSchema>) {
  await requireSession();
  const { totalRecipients } = rolloutPlanSchema.parse(input);
  return planNewRollout(totalRecipients);
}

const capacityTimelineSchema = z.object({ recipientCount: z.number().int().min(1) });

export async function projectCapacityTimelineAction(input: z.infer<typeof capacityTimelineSchema>) {
  const session = await requireSession();
  const { recipientCount } = capacityTimelineSchema.parse(input);
  const accounts = (await listSmtpAccounts(session.user.id)).map(toPlannerAccount);
  return projectAccountCapacityTimeline(accounts, recipientCount);
}

const controlSchema = z.object({
  campaignId: z.string().min(1),
  flag: z.enum(["none", "pause", "cancel"]),
});

export async function setCampaignControlAction(input: z.infer<typeof controlSchema>) {
  const session = await requireSession();
  const parsed = controlSchema.parse(input);

  await setCampaignControlFlag(session.user.id, parsed.campaignId, parsed.flag);
  await logAudit(session.user.id, `campaign.${parsed.flag}`, { type: "campaign", id: parsed.campaignId });

  if (parsed.flag === "none") {
    void startCampaignRunner(parsed.campaignId);
  }

  return { ok: true };
}

const deleteSchema = z.object({ campaignId: z.string().min(1) });

export async function deleteCampaignAction(input: z.infer<typeof deleteSchema>) {
  const session = await requireSession();
  const { campaignId } = deleteSchema.parse(input);

  await deleteCampaign(session.user.id, campaignId);
  await logAudit(session.user.id, "campaign.delete", { type: "campaign", id: campaignId });

  return { ok: true };
}
