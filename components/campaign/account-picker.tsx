"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ageInDays } from "@/services/send-planner";
import type { SmtpAccountRecord } from "@/services/smtp-service";
import { listAccountsForPlanningAction, getSuggestedDailyCapAction } from "@/actions/campaign-actions";

interface AccountPickerProps {
  accountId: string;
  onAccountChange: (accountId: string) => void;
  dailyCap: string;
  onDailyCapChange: (value: string) => void;
}

export function AccountPicker({ accountId, onAccountChange, dailyCap, onDailyCapChange }: AccountPickerProps) {
  const [accounts, setAccounts] = useState<SmtpAccountRecord[]>([]);
  const [suggestion, setSuggestion] = useState<{ ageDays: number; suggestedDailyCap: number } | null>(null);

  useEffect(() => {
    listAccountsForPlanningAction().then((all) => {
      setAccounts(all);
      if (!accountId && all.length > 0) onAccountChange(all[0].id);
    });
    // Only run once on mount — onAccountChange/accountId intentionally excluded
    // to avoid re-fetching the account list on every selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!accountId) {
      setSuggestion(null);
      return;
    }
    getSuggestedDailyCapAction({ accountId }).then(setSuggestion);
  }, [accountId]);

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-amber-400">
        No email accounts connected yet — add one on the Webmails page before creating a campaign.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-4">
      <label className="text-sm font-medium text-zinc-100">Send from</label>
      <select
        value={accountId}
        onChange={(e) => onAccountChange(e.target.value)}
        className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.label} ({account.fromEmail}, {ageInDays(account.mailboxAgeStartDate)}d old)
          </option>
        ))}
      </select>

      <label className="mt-2 text-sm font-medium text-zinc-100">Send per day</label>
      <Input
        placeholder="e.g. 25"
        inputMode="numeric"
        value={dailyCap}
        onChange={(e) => onDailyCapChange(e.target.value)}
      />
      {suggestion && (
        <p className="text-xs text-zinc-500">
          Suggested for a {suggestion.ageDays}-day-old account: {suggestion.suggestedDailyCap}/day. This is
          only a suggestion — send whatever number you decide.
        </p>
      )}
    </div>
  );
}
