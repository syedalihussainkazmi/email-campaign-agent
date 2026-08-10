"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SmtpAccountForm } from "@/components/campaign/smtp-account-form";
import { removeSmtpAccountAction } from "@/actions/settings-actions";
import type { SmtpAccountRecord } from "@/services/smtp-service";
import { ageInDays, capForAge } from "@/services/send-planner";

export function SmtpAccountList({ accounts }: { accounts: SmtpAccountRecord[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(accounts.length === 0);

  async function handleRemove(id: string) {
    await removeSmtpAccountAction(id);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {accounts.map((account) => (
        <div
          key={account.id}
          className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3"
        >
          <div>
            <p className="text-sm font-medium text-zinc-100">{account.label}</p>
            <p className="text-xs text-zinc-500">
              {account.fromEmail} · {ageInDays(account.mailboxAgeStartDate)} days old · safe cap{" "}
              {account.dailyCapOverride ?? capForAge(ageInDays(account.mailboxAgeStartDate))}/day ·
              sent today: {account.sentToday}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="success">Active</Badge>
            <Button size="sm" variant="outline" onClick={() => handleRemove(account.id)}>
              Remove
            </Button>
          </div>
        </div>
      ))}

      {showForm ? (
        <SmtpAccountForm
          onAdded={() => {
            setShowForm(false);
            router.refresh();
          }}
        />
      ) : (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
          + Add Another Account
        </Button>
      )}
    </div>
  );
}
