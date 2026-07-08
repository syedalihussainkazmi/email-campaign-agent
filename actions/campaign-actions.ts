"use server";

import { z } from "zod";
import { requireSession } from "@/auth/session";
import { createCampaign, setCampaignControlFlag } from "@/services/campaign-service";
import { logAudit } from "@/services/audit-service";
import { startCampaignRunner } from "@/server/campaign-runner";
import { isRateLimited } from "@/server/rate-limiter";

const createCampaignSchema = z.object({
  subject: z.string().min(1).max(300),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  recipientEmails: z.array(z.string().email()).min(1),
});

export async function createAndStartCampaignAction(input: z.infer<typeof createCampaignSchema>) {
  const session = await requireSession();
  if (isRateLimited(`create-campaign:${session.user.id}`)) {
    throw new Error("Too many campaigns started, please slow down");
  }

  const parsed = createCampaignSchema.parse(input);
  const campaign = await createCampaign({ userId: session.user.id, ...parsed });

  await logAudit(session.user.id, "campaign.create", { type: "campaign", id: campaign.id });

  void startCampaignRunner(campaign.id);

  return { campaignId: campaign.id };
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
