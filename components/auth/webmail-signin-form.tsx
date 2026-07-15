"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { webmailSignInAction } from "@/actions/webmail-auth-actions";

export function WebmailSignInForm() {
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!expanded) {
    return (
      <Button type="button" variant="outline" size="lg" onClick={() => setExpanded(true)}>
        Connect Webmail
      </Button>
    );
  }

  async function handleSubmit() {
    setError(null);

    if (!email || !password || !host) {
      setError("Email, password, and SMTP host are all required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await webmailSignInAction({
        email,
        password,
        host,
        port: Number(port),
        secure,
      });
      if (result.ok) {
        // Full reload so the server-rendered HomePage picks up the new session cookie.
        window.location.href = "/";
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left">
      <p className="text-xs text-zinc-500">
        Sign in directly with your domain webmail (cPanel, Zoho Mail, Titan, etc.) — no Google account
        needed. Credentials are verified against your real mail server before anything is saved.
      </p>
      <Input placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="SMTP host" value={host} onChange={(e) => setHost(e.target.value)} />
        <Input placeholder="Port" value={port} onChange={(e) => setPort(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
        Use SSL/TLS (port 465)
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" onClick={handleSubmit} disabled={isSubmitting} className="flex-1">
          {isSubmitting ? "Verifying…" : "Sign In"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setExpanded(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
