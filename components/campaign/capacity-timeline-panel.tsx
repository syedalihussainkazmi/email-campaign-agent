"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { projectCapacityTimelineAction } from "@/actions/campaign-actions";
import type { CapacityProjection } from "@/services/send-planner";

export function CapacityTimelinePanel() {
  const [recipientCount, setRecipientCount] = useState("");
  const [projection, setProjection] = useState<CapacityProjection | null>(null);

  async function handleCalculate() {
    const n = Number(recipientCount);
    if (!n || n < 1) return;
    setProjection(await projectCapacityTimelineAction({ recipientCount: n }));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        Using your actual connected accounts and their real ages: how long until you could safely
        clear a list of this size?
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="Recipient count"
          value={recipientCount}
          onChange={(e) => setRecipientCount(e.target.value)}
        />
        <Button size="sm" onClick={handleCalculate}>
          Calculate
        </Button>
      </div>
      {projection && (
        <p className="text-sm text-zinc-300">
          {projection.daysToClear
            ? `You could clear this in ~${projection.daysToClear} days with your current accounts.`
            : "This exceeds what your current accounts can safely clear within 90 days — connect more accounts or reduce the list."}
        </p>
      )}
    </div>
  );
}
