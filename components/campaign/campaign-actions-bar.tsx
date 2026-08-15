"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setCampaignControlAction, deleteCampaignAction } from "@/actions/campaign-actions";
import type { CampaignStatus } from "@/types/campaign";

interface CampaignActionsBarProps {
  campaignId: string;
  status: CampaignStatus;
  /** Renders compact icon-less text buttons — used in dense list rows. */
  size?: "sm" | "default";
}

export function CampaignActionsBar({ campaignId, status, size = "sm" }: CampaignActionsBarProps) {
  const router = useRouter();
  const [pending, setPending] = useState<"pause" | "resume" | "cancel" | "delete" | null>(null);

  async function handleControl(flag: "none" | "pause" | "cancel", pendingLabel: typeof pending) {
    setPending(pendingLabel);
    try {
      await setCampaignControlAction({ campaignId, flag });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this campaign permanently? This can't be undone.")) return;
    setPending("delete");
    try {
      await deleteCampaignAction({ campaignId });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  const canPause = status === "running";
  const canResume = status === "paused";
  const canCancel = status === "running" || status === "paused";

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {canPause && (
        <Button
          size={size}
          variant="outline"
          disabled={pending !== null}
          onClick={() => handleControl("pause", "pause")}
        >
          {pending === "pause" ? "Pausing…" : "Pause"}
        </Button>
      )}
      {canResume && (
        <Button
          size={size}
          variant="outline"
          disabled={pending !== null}
          onClick={() => handleControl("none", "resume")}
        >
          {pending === "resume" ? "Resuming…" : "Resume"}
        </Button>
      )}
      {canCancel && (
        <Button
          size={size}
          variant="destructive"
          disabled={pending !== null}
          onClick={() => handleControl("cancel", "cancel")}
        >
          {pending === "cancel" ? "Cancelling…" : "Cancel"}
        </Button>
      )}
      <Button size={size} variant="ghost" disabled={pending !== null} onClick={handleDelete}>
        {pending === "delete" ? "Deleting…" : "Delete"}
      </Button>
    </div>
  );
}
