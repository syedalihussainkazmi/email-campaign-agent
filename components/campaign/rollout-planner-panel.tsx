"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { panelVariants } from "@/utils/motion";
import { planRolloutAction } from "@/actions/campaign-actions";
import type { RolloutPlan } from "@/services/rollout-planner";

export function RolloutPlannerPanel() {
  const [totalRecipients, setTotalRecipients] = useState("");
  const [plan, setPlan] = useState<RolloutPlan | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  async function handleCalculate() {
    const n = Number(totalRecipients);
    if (!n || n < 1) return;
    setIsCalculating(true);
    const result = await planRolloutAction({ totalRecipients: n });
    setPlan(result);
    setIsCalculating(false);
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
      <AnimatePresence mode="wait">
        {isCalculating && (
          <motion.div
            key="loading"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-4"
          >
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </motion.div>
        )}
        {!isCalculating && plan && (
          <motion.div
            key="loaded"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-300"
          >
            <p>Accounts needed: {plan.accountsNeeded}</p>
            <p>Domains needed (~4 mailboxes/domain): {plan.domainsNeeded}</p>
            <p>Days to clear at that pace: {plan.timeline.length}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
