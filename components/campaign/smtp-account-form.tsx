"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addSmtpAccountAction } from "@/actions/settings-actions";

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SmtpAccountForm({ onAdded }: { onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  // Defaults to "added today" (a brand-new mailbox); edit this if the
  // account has actually been in real use for longer.
  const [mailboxAgeStartDate, setMailboxAgeStartDate] = useState(todayInputValue());
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapSecure, setImapSecure] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setStatus("saving");
    setError(null);
    const result = await addSmtpAccountAction({
      label,
      host,
      port: Number(port),
      secure,
      username,
      password,
      fromEmail,
      mailboxAgeStartDate: new Date(mailboxAgeStartDate),
      imapHost: imapHost || host,
      imapPort: Number(imapPort),
      imapSecure,
    });
    if (result.ok) {
      setLabel("");
      setHost("");
      setUsername("");
      setPassword("");
      setFromEmail("");
      setImapHost("");
      setStatus("idle");
      onAdded();
    } else {
      setStatus("error");
      setError(result.error ?? "Could not verify these SMTP settings");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 p-4">
      <Input placeholder="Label (e.g. Main inbox)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="SMTP host" value={host} onChange={(e) => setHost(e.target.value)} />
        <Input placeholder="Port" value={port} onChange={(e) => setPort(e.target.value)} />
        <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          placeholder="From address"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          className="col-span-2"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
        Use SSL/TLS (port 465)
      </label>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500">
          Mailbox in real use since (defaults to today — change if it&apos;s an existing mailbox)
        </label>
        <Input
          type="date"
          value={mailboxAgeStartDate}
          onChange={(e) => setMailboxAgeStartDate(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
        <label className="text-xs text-zinc-500">
          IMAP (for bounce/reply detection — usually the same host, different port)
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Input
            placeholder="IMAP host (blank = same as SMTP host)"
            value={imapHost}
            onChange={(e) => setImapHost(e.target.value)}
          />
          <Input placeholder="IMAP port (993)" value={imapPort} onChange={(e) => setImapPort(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} />
          Use SSL/TLS (port 993)
        </label>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button size="sm" onClick={handleSave} disabled={status === "saving"}>
        {status === "saving" ? "Verifying…" : "Add Account"}
      </Button>
    </div>
  );
}
