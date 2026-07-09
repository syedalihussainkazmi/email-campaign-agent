"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { saveSignatureAction } from "@/actions/settings-actions";

export function SignatureForm({ initialValue }: { initialValue: string }) {
  const [signature, setSignature] = useState(initialValue);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  async function handleSave() {
    setStatus("saving");
    await saveSignatureAction({ signature });
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        placeholder={"Best,\nSyed Kazmi\nDevXtech — https://devxtech.com"}
        rows={5}
        value={signature}
        onChange={(e) => setSignature(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save Signature"}
        </Button>
        {status === "saved" && <span className="text-xs text-emerald-400">Saved</span>}
      </div>
    </div>
  );
}
