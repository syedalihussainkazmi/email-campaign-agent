"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmailEditor } from "@/components/campaign/email-editor";
import { RecipientDump } from "@/components/campaign/recipient-dump";
import { SendProgress } from "@/components/campaign/send-progress";
import { useRecipientStore } from "@/store/recipient-store";
import { createAndStartCampaignAction } from "@/actions/campaign-actions";

export function CampaignCard() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipients = useRecipientStore((s) => s.valid);
  const clearAll = useRecipientStore((s) => s.clearAll);

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

    setIsSending(true);
    try {
      const { campaignId } = await createAndStartCampaignAction({
        subject,
        bodyHtml: body.replace(/\n/g, "<br/>"),
        bodyText: body,
        recipients,
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
    <Card>
      <CardHeader>
        <CardTitle>New Campaign</CardTitle>
        <CardDescription>Compose, paste recipients, and send at a safe, randomized pace.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <EmailEditor subject={subject} onSubjectChange={setSubject} body={body} onBodyChange={setBody} />
        <RecipientDump />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button onClick={handleSend} disabled={isSending} size="lg">
          {isSending ? "Starting…" : "Send Campaign"}
        </Button>

        {activeCampaignId && <SendProgress campaignId={activeCampaignId} />}
      </CardContent>
    </Card>
  );
}
