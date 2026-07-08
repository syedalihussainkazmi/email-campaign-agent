export type CampaignStatus = "draft" | "running" | "paused" | "completed" | "failed";

export interface CampaignProgress {
  status: CampaignStatus;
  totalCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  currentRecipient: string | null;
}

export interface RecipientCounts {
  valid: number;
  invalid: number;
  duplicates: number;
}
