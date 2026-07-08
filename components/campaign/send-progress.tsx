"use client";

import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCampaignProgress } from "@/hooks/use-campaign-progress";
import { setCampaignControlAction } from "@/actions/campaign-actions";

export function SendProgress({ campaignId }: { campaignId: string }) {
  const progress = useCampaignProgress(campaignId);

  if (!progress) return null;

  const percent = progress.totalCount === 0 ? 0 : (progress.sentCount / progress.totalCount) * 100;
  const remaining = progress.totalCount - progress.sentCount;
  const etaSeconds = remaining * 7.5; // midpoint of the 5-10s delay window
  const etaMinutes = Math.ceil(etaSeconds / 60);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-zinc-200">
          {progress.status === "running" ? "Sending…" : progress.status}
        </span>
        <Badge>{Math.round(percent)}%</Badge>
      </div>

      <Progress value={percent} />

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
        <span>Sent: {progress.sentCount}/{progress.totalCount}</span>
        <span>Delivered: {progress.deliveredCount}</span>
        <span>Failed: {progress.failedCount}</span>
        {progress.currentRecipient && <span>Current: {progress.currentRecipient}</span>}
        {remaining > 0 && <span>ETA: ~{etaMinutes} min</span>}
      </div>

      {progress.status === "running" && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCampaignControlAction({ campaignId, flag: "pause" })}
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setCampaignControlAction({ campaignId, flag: "cancel" })}
          >
            Cancel
          </Button>
        </div>
      )}

      {progress.status === "paused" && (
        <Button size="sm" onClick={() => setCampaignControlAction({ campaignId, flag: "none" })}>
          Resume
        </Button>
      )}
    </div>
  );
}
