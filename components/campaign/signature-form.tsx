"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { saveSignatureAction } from "@/actions/settings-actions";
import { looksLikeHtml } from "@/utils/html";

export function SignatureForm({ initialValue }: { initialValue: string }) {
  const [signature, setSignature] = useState(initialValue);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  async function handleSave() {
    setStatus("saving");
    await saveSignatureAction({ signature });
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  }

  const isHtml = looksLikeHtml(signature);

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        placeholder={
          "Plain text works:\nBest,\nSyed Kazmi\nDevXtech — https://devxtech.com\n\n" +
          "...or paste HTML from a signature generator (HubSpot, WiseStamp, MySignature) " +
          "for a photo, colored divider, and clickable icons."
        }
        rows={8}
        className="font-mono text-xs"
        value={signature}
        onChange={(e) => setSignature(e.target.value)}
      />

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save Signature"}
        </Button>
        {status === "saved" && <span className="text-xs text-emerald-400">Saved</span>}
        {isHtml && <span className="text-xs text-zinc-500">Detected as HTML</span>}
      </div>

      {signature.trim() && (
        <div>
          <p className="mb-1 text-xs text-zinc-500">Preview (as it will appear in the sent email):</p>
          <div className="rounded-lg border border-zinc-800 bg-white p-4 text-black">
            {isHtml ? (
              <div dangerouslySetInnerHTML={{ __html: signature }} />
            ) : (
              <div className="whitespace-pre-wrap text-sm">{signature}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
