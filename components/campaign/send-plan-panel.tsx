"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { panelVariants } from "@/utils/motion";
import type { SendPlan } from "@/services/send-planner";
import { ageInDays } from "@/services/send-planner";
import type { SmtpAccountRecord } from "@/services/smtp-service";
import { getSendPlanAction, listAccountsForPlanningAction } from "@/actions/campaign-actions";

interface SendPlanPanelProps {
  recipientCount: number;
  hasPersonalization: boolean;
  onAccountsResolved: (accountIds: string[]) => void;
}

export function SendPlanPanel({ recipientCount, hasPersonalization, onAccountsResolved }: SendPlanPanelProps) {
  const [accounts, setAccounts] = useState<SmtpAccountRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [plan, setPlan] = useState<SendPlan | null>(null);

  // Load the account list once, default every active account to selected.
  useEffect(() => {
    listAccountsForPlanningAction().then((all) => {
      setAccounts(all);
      setSelectedIds(all.filter((a) => a.isActive).map((a) => a.id));
    });
  }, []);

  // Recompute the plan whenever recipients, template, or the checked accounts change.
  // (plan is only ever set from the async result below, never synchronously
  // here — the recipientCount===0 case is already handled by the render
  // guard further down, so there's nothing to reset it to.)
  useEffect(() => {
    if (recipientCount === 0 || accounts.length === 0) {
      onAccountsResolved([]);
      return;
    }
    getSendPlanAction({ recipientCount, hasPersonalization, accountIds: selectedIds }).then((result) => {
      setPlan(result);
      onAccountsResolved(result.allocations.map((a) => a.accountId));
    });
  }, [recipientCount, hasPersonalization, selectedIds, accounts.length, onAccountsResolved]);

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  if (accounts.length === 0) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={plan ? "loaded" : "loading"}
        variants={panelVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-4"
      >
        <p className="text-sm font-medium text-zinc-100">Send Plan</p>

        <div className="flex flex-col gap-1">
          {accounts.map((account) => (
            <label key={account.id} className="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={selectedIds.includes(account.id)}
                onChange={() => toggle(account.id)}
              />
              {account.label} ({ageInDays(account.mailboxAgeStartDate)}d old, {account.sentToday} sent today)
            </label>
          ))}
        </div>

        {plan && recipientCount > 0 && (
          <>
            {plan.allocations.map((a) => (
              <div key={a.accountId} className="flex justify-between text-xs text-zinc-400">
                <span>{a.label}</span>
                <span>{a.count} today</span>
              </div>
            ))}
            {plan.estimatedDays > 1 && (
              <Badge variant="warning">Will take ~{plan.estimatedDays} days to finish safely</Badge>
            )}
            {plan.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-400">
                ⚠ {w}
              </p>
            ))}
          </>
        )}

        {!plan && recipientCount > 0 && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
