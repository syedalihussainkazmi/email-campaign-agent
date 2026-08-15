"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmailEditor } from "@/components/campaign/email-editor";
import { RecipientDump } from "@/components/campaign/recipient-dump";
import { SendProgress } from "@/components/campaign/send-progress";
import { AccountPicker } from "@/components/campaign/account-picker";
import { useRecipientStore } from "@/store/recipient-store";
import { createAndStartCampaignAction } from "@/actions/campaign-actions";
import { estimateSendSeconds, formatDuration } from "@/services/send-planner";
import { panelVariants } from "@/utils/motion";

export function CampaignRunnerForm() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [accountId, setAccountId] = useState("");
  const [dailyCap, setDailyCap] = useState("");
  const [useFixedPace, setUseFixedPace] = useState(false);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipients = useRecipientStore((s) => s.valid);
  const clearAll = useRecipientStore((s) => s.clearAll);

  const dailyCapNumber = Number(dailyCap);
  const todaysBatchSize = dailyCapNumber > 0 ? Math.min(recipients.length, dailyCapNumber) : 0;

  async function handleSend() {
    setError(null);

    if (!subject.trim() || !body.trim()) {
      setError("Subject and body are required.");
      return;
    }
    if (recipients.length === 0) {
      setError("Add at least one valid recipient.");
      return;
    }
    if (!accountId) {
      setError("Select an email account to send from.");
      return;
    }
    if (!dailyCapNumber || dailyCapNumber < 1) {
      setError("Enter how many to send per day.");
      return;
    }

    setIsSending(true);
    try {
      const { campaignId } = await createAndStartCampaignAction({
        subject,
        bodyHtml: body.replace(/\n/g, "<br/>"),
        bodyText: body,
        recipients,
        accountId,
        dailyCap: dailyCapNumber,
        useFixedPace,
      });
      setActiveCampaignId(campaignId);
      clearAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start campaign");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <motion.div variants={panelVariants} initial="hidden" animate="visible">
      <Card>
        <CardHeader>
          <CardTitle>New Campaign</CardTitle>
          <CardDescription>Compose, paste recipients, pick an account, and send.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <EmailEditor subject={subject} onSubjectChange={setSubject} body={body} onBodyChange={setBody} />
          <RecipientDump />

          <AccountPicker
            accountId={accountId}
            onAccountChange={setAccountId}
            dailyCap={dailyCap}
            onDailyCapChange={setDailyCap}
          />

          {todaysBatchSize > 0 && (
            <p className="text-xs text-zinc-400">
              Today: {todaysBatchSize} of {recipients.length} recipients — estimated ~
              {formatDuration(estimateSendSeconds(todaysBatchSize, useFixedPace))}
              {recipients.length > todaysBatchSize &&
                `, the rest spread over ${Math.ceil(recipients.length / dailyCapNumber)} days total`}
              .
            </p>
          )}

          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={useFixedPace} onChange={(e) => setUseFixedPace(e.target.checked)} />
            Send at a fixed 5-second pace instead of randomized 5-10s
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button onClick={handleSend} disabled={isSending} size="lg">
            {isSending ? "Starting…" : "Send Campaign"}
          </Button>

          {activeCampaignId && <SendProgress campaignId={activeCampaignId} />}
        </CardContent>
      </Card>
    </motion.div>
  );
}
