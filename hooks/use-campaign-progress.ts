"use client";

import { useEffect, useState } from "react";
import type { CampaignProgress } from "@/types/campaign";

/** Polls campaign progress every 2s while a campaign is active. */
export function useCampaignProgress(campaignId: string | null) {
  const [progress, setProgress] = useState<CampaignProgress | null>(null);

  useEffect(() => {
    if (!campaignId) return;

    let cancelled = false;
    const poll = async () => {
      const res = await fetch(`/api/campaigns/${campaignId}/progress`);
      if (!res.ok || cancelled) return;
      const data: CampaignProgress = await res.json();
      if (!cancelled) setProgress(data);
    };

    poll();
    const interval = setInterval(() => {
      if (progress?.status === "completed" || progress?.status === "failed") {
        clearInterval(interval);
        return;
      }
      poll();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [campaignId, progress?.status]);

  return progress;
}
