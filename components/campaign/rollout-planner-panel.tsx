"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { planRolloutAction } from "@/actions/campaign-actions";
import type { RolloutPlan } from "@/services/rollout-planner";

export function RolloutPlannerPanel() {
  const [totalRecipients, setTotalRecipients] = useState("");
  const [plan, setPlan] = useState<RolloutPlan | null>(null);

  async function handleCalculate() {
    const n = Number(totalRecipients);
    if (!n || n < 1) return;
    setPlan(await planRolloutAction({ totalRecipients: n }));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        &quot;If I want to send this many emails total, starting from zero, how many accounts and
        domains do I need?&quot; — assumes every account is brand new today.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="Total emails to send"
          value={totalRecipients}
          onChange={(e) => setTotalRecipients(e.target.value)}
        />
        <Button size="sm" onClick={handleCalculate}>
          Calculate
        </Button>
      </div>
      {plan && (
        <div className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-300">
          <p>Accounts needed: {plan.accountsNeeded}</p>
          <p>Domains needed (~4 mailboxes/domain): {plan.domainsNeeded}</p>
          <p>Days to clear at that pace: {plan.timeline.length}</p>
        </div>
      )}
    </div>
  );
}
