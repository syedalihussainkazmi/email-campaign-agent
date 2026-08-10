"use server";

import { z } from "zod";
import { requireSession } from "@/auth/session";
import { createCampaign, setCampaignControlFlag } from "@/services/campaign-service";
import { logAudit } from "@/services/audit-service";
import { startCampaignRunner } from "@/server/campaign-runner";
import { isRateLimited } from "@/server/rate-limiter";
import { listSmtpAccounts } from "@/services/smtp-service";
import { buildSendPlan, toPlannerAccount, projectAccountCapacityTimeline } from "@/services/send-planner";
import { planNewRollout } from "@/services/rollout-planner";

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
  accountIds: z.array(z.string()).min(1, "Select at least one email account to send from"),
});

export async function createAndStartCampaignAction(input: z.infer<typeof createCampaignSchema>) {
  const session = await requireSession();
  if (isRateLimited(`create-campaign:${session.user.id}`)) {
    throw new Error("Too many campaigns started, please slow down");
  }

  const parsed = createCampaignSchema.parse(input);
  const hasPersonalization = /\{(name|business ?name|owner|owner ?name|first ?name|fname)\}/i.test(
    parsed.subject + parsed.bodyHtml,
  );
  // Re-filter to exactly the accounts the user had checked in the SendPlanPanel —
  // never silently fall back to "all active accounts" at send time.
  const allAccounts = await listSmtpAccounts(session.user.id);
  const selectedAccounts = allAccounts.filter((a) => parsed.accountIds.includes(a.id)).map(toPlannerAccount);
  const plan = buildSendPlan(parsed.recipients.length, selectedAccounts, { hasPersonalization });

  const campaign = await createCampaign({
    userId: session.user.id,
    subject: parsed.subject,
    bodyHtml: parsed.bodyHtml,
    bodyText: parsed.bodyText,
    recipients: parsed.recipients,
    accountAllocations: plan.allocations,
  });

  await logAudit(session.user.id, "campaign.create", { type: "campaign", id: campaign.id });

  void startCampaignRunner(campaign.id);

  return { campaignId: campaign.id };
}

export async function listAccountsForPlanningAction() {
  const session = await requireSession();
  return listSmtpAccounts(session.user.id);
}

const sendPlanSchema = z.object({
  recipientCount: z.number().int().min(0),
  hasPersonalization: z.boolean(),
  accountIds: z.array(z.string()).default([]),
});

export async function getSendPlanAction(input: z.infer<typeof sendPlanSchema>) {
  const session = await requireSession();
  const { recipientCount, hasPersonalization, accountIds } = sendPlanSchema.parse(input);
  const allAccounts = await listSmtpAccounts(session.user.id);
  const selected = allAccounts.filter((a) => accountIds.includes(a.id)).map(toPlannerAccount);
  return buildSendPlan(recipientCount, selected, { hasPersonalization });
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
