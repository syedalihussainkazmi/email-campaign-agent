"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { panelVariants } from "@/utils/motion";
import { projectCapacityTimelineAction } from "@/actions/campaign-actions";
import type { CapacityProjection } from "@/services/send-planner";

export function CapacityTimelinePanel() {
  const [recipientCount, setRecipientCount] = useState("");
  const [projection, setProjection] = useState<CapacityProjection | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  async function handleCalculate() {
    const n = Number(recipientCount);
    if (!n || n < 1) return;
    setIsCalculating(true);
    const result = await projectCapacityTimelineAction({ recipientCount: n });
    setProjection(result);
    setIsCalculating(false);
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
        {!isCalculating && projection && (
          <motion.p
            key="loaded"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="text-sm text-zinc-300"
          >
            {projection.daysToClear
              ? `You could clear this in ~${projection.daysToClear} days with your current accounts.`
              : "This exceeds what your current accounts can safely clear within 90 days — connect more accounts or reduce the list."}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
