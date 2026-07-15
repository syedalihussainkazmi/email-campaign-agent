"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveSmtpConfigAction, disconnectSmtpAction } from "@/actions/settings-actions";

export interface SmtpFormInitialValue {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromEmail: string;
}

export function SmtpForm({ initialValue }: { initialValue: SmtpFormInitialValue | null }) {
  const [host, setHost] = useState(initialValue?.host ?? "");
  const [port, setPort] = useState(String(initialValue?.port ?? 587));
  const [secure, setSecure] = useState(initialValue?.secure ?? false);
  const [username, setUsername] = useState(initialValue?.username ?? "");
  const [fromEmail, setFromEmail] = useState(initialValue?.fromEmail ?? "");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setStatus("saving");
    setError(null);

    const result = await saveSmtpConfigAction({
      host,
      port: Number(port),
      secure,
      username,
      password,
      fromEmail,
    });

    if (result.ok) {
      setStatus("saved");
      setPassword("");
      setTimeout(() => setStatus("idle"), 2000);
    } else {
      setStatus("error");
      setError(result.error ?? "Could not verify these SMTP settings");
    }
  }

  async function handleDisconnect() {
    await disconnectSmtpAction();
    setHost("");
    setPort("587");
    setSecure(false);
    setUsername("");
    setFromEmail("");
    setPassword("");
    setStatus("idle");
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        Configure this to send campaigns through your own domain webmail (cPanel, Zoho Mail, Titan,
        etc.) instead of Gmail. If set, this takes priority over your connected Gmail account.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="SMTP host (mail.devxtech.com)" value={host} onChange={(e) => setHost(e.target.value)} />
        <Input placeholder="Port (587 or 465)" value={port} onChange={(e) => setPort(e.target.value)} />
        <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input
          type="password"
          placeholder={initialValue ? "Password (leave blank to keep current)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          placeholder="From address (you@devxtech.com)"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          className="col-span-2"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
        Use SSL/TLS (usually on for port 465, off for port 587)
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={status === "saving"}>
          {status === "saving" ? "Verifying…" : "Save & Verify"}
        </Button>
        {initialValue && (
          <Button size="sm" variant="outline" onClick={handleDisconnect}>
            Disconnect
          </Button>
        )}
        {status === "saved" && <span className="text-xs text-emerald-400">Connected</span>}
      </div>
    </div>
  );
}
