# Webmail-Only Multi-Account Send Planner Implementation Plan

**Goal:** Remove Gmail/OAuth and the dev-login bypass entirely, let one admin connect multiple labeled webmail (SMTP) accounts, and add a "brain" that calculates a safe, spam-avoiding send plan across those accounts before any campaign goes out.

**Architecture:** Auth becomes 100% webmail-credential-based (already partially built via `webmailSignInAction`) with a lightweight custom session reader replacing next-auth's OAuth machinery. A new `SmtpAccount` table replaces the single per-user SMTP config, so an admin holds a pool of mailboxes. A new pure, side-effect-free `send-planner` module computes per-account/per-day allocation and deliverability warnings from mailbox trust level + recipient count + template personalization. Campaigns snapshot each recipient's assigned account and send day at creation time (same pattern already used for name/ownerName), and the runner becomes account-and-day aware instead of single-sender.

**Tech Stack:** Next.js App Router, Prisma/Postgres, nodemailer (already added), Vitest.

---

## Scope note

This plan covers four subsystems that depend on each other in sequence (auth cleanup → multi-account model → planner brain → runner integration), so they're kept as one plan rather than split — each task still produces a working, independently testable slice, and you can stop after any task with the app in a working state.

## File Structure

| File | Responsibility |
|---|---|
| `auth/session.ts` | Rewritten: reads the session cookie + `Session`/`User` tables directly, no next-auth/OAuth. |
| `auth/auth.ts` | Deleted (was next-auth config + Google provider + `getDecryptedGoogleAccount`). |
| `auth/session-cookie.ts` | Unchanged — already the cookie-writing helper used by webmail login. |
| `app/api/auth/[...nextauth]/route.ts` | Deleted — no OAuth callback route needed. |
| `services/gmail-service.ts` | Deleted. |
| `actions/dev-auth-actions.ts` | Deleted. |
| `utils/dev-login.ts` | Deleted. |
| `prisma/schema.prisma` | `Account` model dropped; `User.role` kept; new `SmtpAccount` model; `CampaignRecipient` gains `smtpAccountId` + `scheduledFor`. |
| `services/smtp-service.ts` | Rewritten from single-blob-per-user to full CRUD over `SmtpAccount` rows (list/create/update/delete/get). |
| `services/send-planner.ts` | New. Pure functions: `buildSendPlan` (today's allocation), `capForAge`/`ageInDays` (the ramp curve), `projectAccountCapacityTimeline` (forward projection for existing accounts). |
| `tests/send-planner.test.ts` | New. |
| `services/rollout-planner.ts` | New. Pure "what-if I'm starting from zero" calculator: `planNewRollout(totalRecipients, options) => { accountsNeeded, domainsNeeded, timeline }`. |
| `tests/rollout-planner.test.ts` | New. |
| `services/domain-age-service.ts` | New. Best-effort domain-age lookup via public WHOIS, plus a pure `parseWhoisDate` helper. |
| `tests/domain-age-service.test.ts` | New — covers only the pure date-parsing helper, not the live network call. |
| `components/campaign/rollout-planner-panel.tsx` | New. "If I want to send N emails, how many accounts/domains do I need" calculator, in Settings. |
| `components/campaign/capacity-timeline-panel.tsx` | New. Projects days-to-clear using your *actual* connected accounts and their real ages, in Settings. |
| `components/campaign/smtp-account-list.tsx` | New. Replaces `smtp-form.tsx` — lists accounts, add/edit/delete. |
| `components/campaign/smtp-account-form.tsx` | New. Single-account add/edit form (extracted from old `smtp-form.tsx`). |
| `components/campaign/send-plan-panel.tsx` | New. Shows the computed plan + account selection before sending. |
| `actions/settings-actions.ts` | SMTP actions rewritten for multi-account CRUD. |
| `actions/webmail-auth-actions.ts` | On signup, creates the first `SmtpAccount` row instead of the old single-config write. |
| `services/campaign-service.ts` | `createCampaign` now takes selected account IDs + the computed plan, assigns `smtpAccountId`/`scheduledFor` per recipient. |
| `server/campaign-runner.ts` | Sends only recipients whose `scheduledFor <= today`, using each recipient's assigned `SmtpAccount`; increments that account's `sentToday`. |
| `services/email-sender.ts` | `getEmailSenderForAccount(smtpAccountId)` replaces `getEmailSenderForUser(userId)`. |
| `app/settings/page.tsx` | Gmail card removed; renders `smtp-account-list`. |
| `services/imap-service.ts` | New. Connects to an account's inbox via IMAP, fetches messages received since a given time. |
| `services/bounce-detector.ts` | New. Pure function: classifies a parsed inbound message as a bounce (or not) and extracts the failed recipient address. |
| `services/reply-detector.ts` | New. Pure function: matches an inbound message to an outstanding sent recipient via `In-Reply-To`/`References` threading, with an address-match fallback. |
| `server/inbox-poller.ts` | New. Polls every IMAP-configured account, runs bounce + reply detection, updates `CampaignRecipient` rows. |
| `app/api/campaigns/poll-inbox/route.ts` | New. External trigger endpoint for the poller (needs a periodic ping, same as the multi-day resume endpoint). |
| `app/api/track/open/[trackingId]/route.ts` | New (optional). 1x1 pixel endpoint, records `openedAt`. |
| `app/api/track/click/[trackingId]/route.ts` | New (optional). Redirect-through endpoint, records `firstClickedAt`/`clickCount`. |
| `utils/link-tracking.ts` | New (optional). Rewrites `<a href>`s in an HTML body to route through the click-tracking endpoint. |
| `services/unsubscribe-service.ts` | New. Pure `buildUnsubscribeHeaders`, plus DB-backed lookup/mark-unsubscribed functions. |
| `app/api/unsubscribe/[token]/route.ts` | New. GET (human click) and POST (RFC 8058 one-click) both mark the recipient unsubscribed. |
| `services/sending-window-service.ts` | New. Pure `isWithinSendingWindow`, plus a per-user Setting for the configured window. |
| `utils/motion.ts` | New. Shared framer-motion timing/easing tokens and panel-transition variants. |
| `components/ui/progress.tsx` | Rewritten to animate via `scaleX` transform instead of `width`, avoiding layout thrash. |
| `components/ui/button.tsx` | Adds press-scale feedback (needs `transform` added to the transitioned properties). |
| `components/ui/skeleton.tsx` | New. Shared pulsing loading placeholder for the calculator panels. |
| `app/page.tsx` | Gmail button + dev-login button removed; only the webmail form remains (no longer collapsible — it's the only option). |

---

### Task 1: Remove Gmail/OAuth and the dev-login bypass

**Files:**
- Delete: `auth/auth.ts`, `services/gmail-service.ts`, `actions/dev-auth-actions.ts`, `utils/dev-login.ts`, `app/api/auth/[...nextauth]/route.ts`
- Modify: `auth/session.ts`, `app/page.tsx`, `app/settings/page.tsx`
- Modify: `prisma/schema.prisma` (drop `Account` model + its relation on `User`)
- Modify: `package.json` (remove `next-auth`, `@auth/prisma-adapter`, `googleapis`)

- [ ] **Step 1: Read the current `auth/session.ts` to see what it exports today**

Run: `cat /home/user/email-campaign-agent/auth/session.ts`

Expected: it currently wraps next-auth's `auth()` — note every function name it exports (e.g. `requireSession`), since callers must keep working unchanged.

- [ ] **Step 2: Rewrite `auth/session.ts` as a standalone cookie/DB session reader**

```typescript
import { cookies } from "next/headers";
import { prisma } from "@/database/prisma";

const SESSION_COOKIE = "authjs.session-token";

export interface Session {
  user: { id: string; email: string; name: string | null; role: string };
}

/** Reads the current session directly from the cookie + Session table — no OAuth provider involved. */
export async function auth(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    include: { user: true },
  });

  if (!session || session.expires < new Date()) return null;

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
    },
  };
}

export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session) throw new Error("Not authenticated");
  return session;
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { sessionToken: token } });
  }
  cookieStore.delete(SESSION_COOKIE);
}
```

- [ ] **Step 3: Find every file importing from `@/auth/auth` and switch it to `@/auth/session`**

Run: `grep -rln "from \"@/auth/auth\"" /home/user/email-campaign-agent --include="*.ts" --include="*.tsx" --exclude-dir=node_modules`

Expected output will include `app/page.tsx`, `app/settings/page.tsx`, and any admin pages calling `auth()`/`getDecryptedGoogleAccount`. For each file: replace `import { auth, signIn, getDecryptedGoogleAccount } from "@/auth/auth"` with `import { auth } from "@/auth/session"`, and delete any code branch that called `signIn("google")` or `getDecryptedGoogleAccount`.

- [ ] **Step 4: Rewrite `app/page.tsx`'s signed-out branch to only show webmail sign-in**

```typescript
import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { CampaignCard } from "@/components/campaign/campaign-card";
import { WebmailSignInForm } from "@/components/auth/webmail-signin-form";

export default async function HomePage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">MailPilot</h1>
          <p className="mt-2 text-sm text-zinc-400">
            AI-assisted email campaigns, sent from your own webmail.
          </p>
        </div>
        <WebmailSignInForm />
      </div>
    );
  }

  return (
    <AuthedShell>
      <CampaignCard />
    </AuthedShell>
  );
}
```

- [ ] **Step 5: Remove the "Connect Webmail" collapse-toggle in `components/auth/webmail-signin-form.tsx` since it's now the only sign-in option**

Delete the `expanded`/`setExpanded` state and the early-return button — the form itself is now what renders immediately on `if (!expanded)`'s old branch. Keep everything else (the actual `<Input>` fields, `handleSubmit`, error display) unchanged.

- [ ] **Step 6: Delete the dead files**

Run:
```bash
rm /home/user/email-campaign-agent/auth/auth.ts
rm /home/user/email-campaign-agent/services/gmail-service.ts
rm /home/user/email-campaign-agent/actions/dev-auth-actions.ts
rm /home/user/email-campaign-agent/utils/dev-login.ts
rm -rf /home/user/email-campaign-agent/app/api/auth
```

- [ ] **Step 7: Drop the `Account` model from `prisma/schema.prisma`**

Delete the entire `model Account { ... }` block and remove the `accounts Account[]` line from `model User`.

- [ ] **Step 8: Remove now-unused dependencies and run a migration**

Run:
```bash
cd /home/user/email-campaign-agent
npm uninstall next-auth @auth/prisma-adapter googleapis
npx prisma migrate dev --name drop_oauth_account_model
```
Expected: migration applies cleanly (there should be zero rows in `Account` in a fresh dev DB, so no data-loss prompt should block it; if prompted about data loss on a populated dev DB, confirm — this is intentional).

- [ ] **Step 9: Typecheck and fix remaining references**

Run: `npx tsc --noEmit`
Expected: errors will point at any remaining `next-auth`/`gmail-service`/`dev-login` imports — fix each by following Step 3's pattern until clean.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Remove Gmail/OAuth and dev-login bypass, webmail-only auth"
```

---

### Task 2: `SmtpAccount` model — multi-account data layer

**Files:**
- Modify: `prisma/schema.prisma`
- Rewrite: `services/smtp-service.ts`
- Test: `tests/smtp-service.test.ts` (skipped — this module is DB-backed; covered by the manual browser verification in Task 3 instead, per existing project convention of not mocking Prisma in unit tests)

- [ ] **Step 1: Add the `SmtpAccount` model**

```prisma
model SmtpAccount {
  id                String    @id @default(cuid())
  userId            String
  label             String
  host              String
  port              Int
  secure            Boolean
  username          String
  encryptedPassword String
  fromEmail         String
  // The date warmup/age is calculated from — defaults to "added today" but
  // editable, since an account may already be an established real mailbox.
  mailboxAgeStartDate DateTime @default(now())
  dailyCapOverride  Int?
  sentToday         Int       @default(0)
  sentTodayDate     DateTime  @default(now())
  isActive          Boolean   @default(true)
  createdAt         DateTime  @default(now())

  user       User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  recipients CampaignRecipient[]

  @@index([userId])
}
```

Add `smtpAccounts SmtpAccount[]` to `model User`.

- [ ] **Step 2: Rewrite `services/smtp-service.ts` as full CRUD**

```typescript
import { prisma } from "@/database/prisma";
import { encryptToken, decryptToken } from "@/services/token-service";

export interface SmtpAccountInput {
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  mailboxAgeStartDate: Date;
  dailyCapOverride?: number;
}

export interface SmtpAccountRecord extends Omit<SmtpAccountInput, "password"> {
  id: string;
  sentToday: number;
  isActive: boolean;
}

/** Resets sentToday to 0 exactly once per calendar day, on first read after midnight. */
async function rolloverIfNewDay(id: string, sentTodayDate: Date) {
  const today = new Date();
  const isSameDay =
    sentTodayDate.getFullYear() === today.getFullYear() &&
    sentTodayDate.getMonth() === today.getMonth() &&
    sentTodayDate.getDate() === today.getDate();

  if (!isSameDay) {
    await prisma.smtpAccount.update({
      where: { id },
      data: { sentToday: 0, sentTodayDate: today },
    });
    return 0;
  }
  return null;
}

export async function listSmtpAccounts(userId: string): Promise<SmtpAccountRecord[]> {
  const rows = await prisma.smtpAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  const records: SmtpAccountRecord[] = [];
  for (const row of rows) {
    const rolledOver = await rolloverIfNewDay(row.id, row.sentTodayDate);
    records.push({
      id: row.id,
      label: row.label,
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      fromEmail: row.fromEmail,
      mailboxAgeStartDate: row.mailboxAgeStartDate,
      dailyCapOverride: row.dailyCapOverride ?? undefined,
      sentToday: rolledOver ?? row.sentToday,
      isActive: row.isActive,
    });
  }
  return records;
}

export async function getSmtpAccountWithPassword(id: string, userId: string) {
  const row = await prisma.smtpAccount.findFirst({ where: { id, userId } });
  if (!row) return null;
  return { ...row, password: decryptToken(row.encryptedPassword) };
}

export async function createSmtpAccount(userId: string, input: SmtpAccountInput) {
  return prisma.smtpAccount.create({
    data: {
      userId,
      label: input.label,
      host: input.host,
      port: input.port,
      secure: input.secure,
      username: input.username,
      encryptedPassword: encryptToken(input.password),
      fromEmail: input.fromEmail,
      mailboxAgeStartDate: input.mailboxAgeStartDate,
      dailyCapOverride: input.dailyCapOverride,
    },
  });
}

export async function deleteSmtpAccount(id: string, userId: string) {
  await prisma.smtpAccount.deleteMany({ where: { id, userId } });
}

export async function incrementSentToday(id: string) {
  await prisma.smtpAccount.update({ where: { id }, data: { sentToday: { increment: 1 } } });
}
```

- [ ] **Step 3: Run migration and typecheck**

Run:
```bash
cd /home/user/email-campaign-agent
npx prisma migrate dev --name add_smtp_account_multi
npx tsc --noEmit
```
Expected: `tsc` will now show errors in `smtp-sender.ts`, `settings-actions.ts`, `email-sender.ts`, `webmail-auth-actions.ts` — these are fixed in Tasks 3–4 and 7–9, not this task. Confirm the errors are *only* in those known files before moving on.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add SmtpAccount model for multi-webmail-account support"
```

---

### Task 3: Settings UI — manage multiple accounts

**Files:**
- Create: `components/campaign/smtp-account-form.tsx`
- Create: `components/campaign/smtp-account-list.tsx`
- Delete: `components/campaign/smtp-form.tsx`
- Modify: `actions/settings-actions.ts`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Rewrite the SMTP actions in `actions/settings-actions.ts` for multi-account CRUD**

```typescript
const smtpAccountSchema = z.object({
  label: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1),
  fromEmail: z.string().email(),
  mailboxAgeStartDate: z.coerce.date(),
  dailyCapOverride: z.coerce.number().int().min(1).optional(),
});

export async function addSmtpAccountAction(input: z.infer<typeof smtpAccountSchema>) {
  const session = await requireSession();
  const parsed = smtpAccountSchema.parse(input);

  const verification = await verifySmtpConfig(parsed);
  if (!verification.ok) {
    return { ok: false, error: verification.error ?? "Could not connect with these SMTP settings" };
  }

  await createSmtpAccount(session.user.id, parsed);
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeSmtpAccountAction(accountId: string) {
  const session = await requireSession();
  await deleteSmtpAccount(accountId, session.user.id);
  revalidatePath("/settings");
  return { ok: true };
}
```
Delete `saveSmtpConfigAction`/`disconnectSmtpAction` and their imports of the old single-config `smtp-service` functions.

- [ ] **Step 2: Extract the account form fields into `components/campaign/smtp-account-form.tsx`**

```typescript
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
  // account has actually been in real use for longer. Task 12 adds a
  // "Detect from domain" button that suggests a value here via WHOIS.
  const [mailboxAgeStartDate, setMailboxAgeStartDate] = useState(todayInputValue());
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
    });
    if (result.ok) {
      setLabel("");
      setHost("");
      setUsername("");
      setPassword("");
      setFromEmail("");
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
          Mailbox in real use since (defaults to today — change if it's an existing mailbox)
        </label>
        <Input
          type="date"
          value={mailboxAgeStartDate}
          onChange={(e) => setMailboxAgeStartDate(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button size="sm" onClick={handleSave} disabled={status === "saving"}>
        {status === "saving" ? "Verifying…" : "Add Account"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Build the list view in `components/campaign/smtp-account-list.tsx`**

```typescript
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
```

- [ ] **Step 4: Wire into `app/settings/page.tsx`**

Replace the "Gmail Connection" and "Custom SMTP" cards with:
```typescript
import { listSmtpAccounts } from "@/services/smtp-service";
import { SmtpAccountList } from "@/components/campaign/smtp-account-list";
// ...
const accounts = await listSmtpAccounts(session.user.id);
// ...
<Card>
  <CardHeader>
    <CardTitle>Email Accounts</CardTitle>
    <CardDescription>Connect as many webmail accounts as you want to send from.</CardDescription>
  </CardHeader>
  <CardContent>
    <SmtpAccountList accounts={accounts} />
  </CardContent>
</Card>
```

- [ ] **Step 5: Delete the old single-account form and verify**

Run:
```bash
rm /home/user/email-campaign-agent/components/campaign/smtp-form.tsx
cd /home/user/email-campaign-agent
npx tsc --noEmit
```
Expected: remaining errors should only be in `webmail-auth-actions.ts` and `email-sender.ts` (fixed next).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Replace single SMTP config with a multi-account Settings UI"
```

---

### Task 4: Webmail sign-in creates the first `SmtpAccount`

**Files:**
- Modify: `actions/webmail-auth-actions.ts`

- [ ] **Step 1: Replace the old `setSmtpConfig` call with `createSmtpAccount`, labeled "Primary"**

```typescript
import { createSmtpAccount } from "@/services/smtp-service";
// ...
const assumedMailboxAge = new Date();
assumedMailboxAge.setDate(assumedMailboxAge.getDate() - 90); // treat as "established" by default

await createSmtpAccount(user.id, {
  label: "Primary",
  host: parsed.host,
  port: parsed.port,
  secure: parsed.secure,
  username: parsed.email,
  password: parsed.password,
  fromEmail: parsed.email,
  mailboxAgeStartDate: assumedMailboxAge,
});
```
(Backdating the very first account's age by 90 days is a deliberate choice: it's presumably an existing mailbox they already use to sign in, not a throwaway new one — they can correct this to the real age later in Settings, or use the WHOIS detector from Task 12.)

- [ ] **Step 2: Typecheck and test**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no errors remaining outside `email-sender.ts`/`campaign-runner.ts`/`campaign-service.ts` (Tasks 7–9).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Webmail sign-in creates the first SmtpAccount"
```

---

### Task 5: The "brain" — `send-planner.ts`

**Files:**
- Create: `services/send-planner.ts`
- Test: `tests/send-planner.test.ts`

- [ ] **Step 1: Write the failing tests first**

```typescript
import { describe, it, expect } from "vitest";
import { buildSendPlan, capForAge, ageInDays } from "@/services/send-planner";

const account = (overrides: Partial<Parameters<typeof buildSendPlan>[1][number]> = {}) => ({
  id: "acc1",
  label: "Main",
  ageDays: 90, // established, cap 100
  dailyCapOverride: undefined,
  sentToday: 0,
  isActive: true,
  ...overrides,
});

describe("capForAge", () => {
  it("follows the ramp schedule as the account gets older", () => {
    expect(capForAge(0)).toBe(10);
    expect(capForAge(3)).toBe(10);
    expect(capForAge(4)).toBe(25);
    expect(capForAge(14)).toBe(25);
    expect(capForAge(15)).toBe(50);
    expect(capForAge(29)).toBe(50);
    expect(capForAge(30)).toBe(75);
    expect(capForAge(59)).toBe(75);
    expect(capForAge(60)).toBe(100);
    expect(capForAge(365)).toBe(100);
  });
});

describe("ageInDays", () => {
  it("computes whole days elapsed since a given date", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    expect(ageInDays(tenDaysAgo)).toBe(10);
  });
});

describe("buildSendPlan", () => {
  it("fits everything in one day across a single established account", () => {
    const plan = buildSendPlan(80, [account()], { hasPersonalization: true });
    expect(plan.estimatedDays).toBe(1);
    expect(plan.allocations).toEqual([{ accountId: "acc1", label: "Main", count: 80 }]);
    expect(plan.warnings).toEqual([]);
  });

  it("splits across multiple accounts respecting each one's remaining cap", () => {
    const accounts = [
      account({ id: "a", label: "A", ageDays: 1 }), // cap 10
      account({ id: "b", label: "B", ageDays: 10 }), // cap 25
    ];
    const plan = buildSendPlan(30, accounts, { hasPersonalization: true });
    expect(plan.estimatedDays).toBe(1);
    expect(plan.allocations).toEqual([
      { accountId: "b", label: "B", count: 25 },
      { accountId: "a", label: "A", count: 5 },
    ]);
  });

  it("accounts for what's already been sent today", () => {
    const accounts = [account({ sentToday: 90 })]; // established cap 100, 10 left
    const plan = buildSendPlan(10, accounts, { hasPersonalization: true });
    expect(plan.allocations).toEqual([{ accountId: "acc1", label: "Main", count: 10 }]);
    expect(plan.estimatedDays).toBe(1);
  });

  it("spreads across multiple days when total capacity is exceeded", () => {
    const plan = buildSendPlan(250, [account()], { hasPersonalization: true }); // cap 100/day
    expect(plan.estimatedDays).toBe(3);
    expect(plan.warnings.some((w) => w.includes("3 days"))).toBe(true);
  });

  it("warns when zero accounts are active", () => {
    const plan = buildSendPlan(10, [], { hasPersonalization: true });
    expect(plan.warnings.some((w) => w.includes("no active"))).toBe(true);
    expect(plan.allocations).toEqual([]);
  });

  it("warns when the template has no personalization tokens", () => {
    const plan = buildSendPlan(50, [account()], { hasPersonalization: false });
    expect(plan.warnings.some((w) => w.toLowerCase().includes("personalization"))).toBe(true);
  });

  it("ignores inactive accounts entirely", () => {
    const accounts = [account({ isActive: false }), account({ id: "b", label: "B" })];
    const plan = buildSendPlan(10, accounts, { hasPersonalization: true });
    expect(plan.allocations).toEqual([{ accountId: "b", label: "B", count: 10 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/send-planner.test.ts`
Expected: FAIL — `Cannot find module '@/services/send-planner'`

- [ ] **Step 3: Implement `services/send-planner.ts`**

```typescript
export interface RampStep {
  minAgeDays: number;
  dailyCap: number;
}

/**
 * Conservative daily-safe-send ceiling by mailbox age, ramping up over
 * time. These are heuristics from common cold-outreach/warm-up guidance,
 * not a guarantee from any provider — override per account in Settings
 * (dailyCapOverride) if you know your real limits differ.
 */
export const DEFAULT_RAMP_SCHEDULE: RampStep[] = [
  { minAgeDays: 0, dailyCap: 10 },
  { minAgeDays: 4, dailyCap: 25 },
  { minAgeDays: 15, dailyCap: 50 },
  { minAgeDays: 30, dailyCap: 75 },
  { minAgeDays: 60, dailyCap: 100 },
];

/** The safe daily cap for a mailbox of the given age, per the ramp schedule. */
export function capForAge(ageDays: number, schedule: RampStep[] = DEFAULT_RAMP_SCHEDULE): number {
  let cap = schedule[0].dailyCap;
  for (const step of schedule) {
    if (ageDays >= step.minAgeDays) cap = step.dailyCap;
  }
  return cap;
}

/** Whole days elapsed since `since`. */
export function ageInDays(since: Date): number {
  return Math.floor((Date.now() - since.getTime()) / 86400000);
}

export interface PlannerAccount {
  id: string;
  label: string;
  ageDays: number;
  dailyCapOverride?: number;
  sentToday: number;
  isActive: boolean;
}

export interface SendPlan {
  totalRecipients: number;
  estimatedDays: number;
  allocations: { accountId: string; label: string; count: number }[];
  warnings: string[];
}

function dailyCapFor(account: PlannerAccount): number {
  return account.dailyCapOverride ?? capForAge(account.ageDays);
}

function remainingToday(account: PlannerAccount): number {
  return Math.max(0, dailyCapFor(account) - account.sentToday);
}

/** Converts a stored SmtpAccount-shaped record (mailboxAgeStartDate) into a PlannerAccount (ageDays). */
export function toPlannerAccount(account: {
  id: string;
  label: string;
  mailboxAgeStartDate: Date;
  dailyCapOverride?: number;
  sentToday: number;
  isActive: boolean;
}): PlannerAccount {
  return {
    id: account.id,
    label: account.label,
    ageDays: ageInDays(account.mailboxAgeStartDate),
    dailyCapOverride: account.dailyCapOverride,
    sentToday: account.sentToday,
    isActive: account.isActive,
  };
}

/**
 * Computes how to split `recipientCount` new sends across the given
 * accounts without exceeding any single account's safe daily ceiling,
 * plus how many days it will take if total capacity is exceeded today.
 * Pure function — no I/O, no side effects, fully unit-testable.
 */
export function buildSendPlan(
  recipientCount: number,
  accounts: PlannerAccount[],
  template: { hasPersonalization: boolean },
): SendPlan {
  const warnings: string[] = [];
  const active = accounts.filter((a) => a.isActive);

  if (active.length === 0) {
    warnings.push("You have no active email accounts connected — add one in Settings before sending.");
    return { totalRecipients: recipientCount, estimatedDays: 0, allocations: [], warnings };
  }

  if (!template.hasPersonalization) {
    warnings.push(
      "Your subject/body has no personalization tokens ({business name}/{owner name}) — sending " +
        "identical content to many recipients raises spam risk regardless of volume.",
    );
  }

  const totalDailyCapacity = active.reduce((sum, a) => sum + dailyCapFor(a), 0);
  const estimatedDays = Math.max(1, Math.ceil(recipientCount / totalDailyCapacity));

  if (estimatedDays > 1) {
    warnings.push(
      `${recipientCount} recipients exceeds your connected accounts' safe daily capacity ` +
        `(${totalDailyCapacity}/day). Spreading this over ${estimatedDays} days, or connect ` +
        `more accounts to finish sooner.`,
    );
  }

  // Allocate today's batch only — largest-remaining-capacity-first.
  const todaysBatchSize = Math.min(recipientCount, totalDailyCapacity);
  const sorted = [...active].sort((a, b) => remainingToday(b) - remainingToday(a));

  const allocations: SendPlan["allocations"] = [];
  let remaining = todaysBatchSize;
  for (const account of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remainingToday(account), remaining);
    if (take > 0) {
      allocations.push({ accountId: account.id, label: account.label, count: take });
      remaining -= take;
    }
  }

  return { totalRecipients: recipientCount, estimatedDays, allocations, warnings };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/send-planner.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add send-planner: the deliverability brain"
```

---

### Task 6: `SendPlanPanel` — surface the plan before sending

**Files:**
- Create: `components/campaign/send-plan-panel.tsx`
- Modify: `components/campaign/campaign-card.tsx` (wire the panel in before the Send button; exact integration point depends on that file's current structure — read it first)

- [ ] **Step 1: Read the current campaign-card to find where recipients/template state live**

Run: `cat /home/user/email-campaign-agent/components/campaign/campaign-card.tsx`

Note the state variable names for `subject`, `body`, and the recipient list from `useRecipientStore` — the panel needs `recipients.length` and whether `subject`/`body` contain `{business name}`/`{owner name}`/`{first name}` (any casing) to compute `hasPersonalization`.

- [ ] **Step 2: Add a lightweight "list accounts for planning" action**

```typescript
// in actions/campaign-actions.ts
import { listSmtpAccounts } from "@/services/smtp-service";

export async function listAccountsForPlanningAction() {
  const session = await requireSession();
  return listSmtpAccounts(session.user.id);
}
```

- [ ] **Step 3: Build `components/campaign/send-plan-panel.tsx` with per-account checkboxes**

```typescript
"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
  useEffect(() => {
    if (recipientCount === 0 || accounts.length === 0) {
      setPlan(null);
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
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-4">
      <p className="text-sm font-medium text-zinc-100">Send Plan</p>

      <div className="flex flex-col gap-1">
        {accounts.map((account) => (
          <label key={account.id} className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={selectedIds.includes(account.id)}
              onChange={() => toggle(account.id)}
            />
            {account.label} ({ageInDays(account.mailboxAgeStartDate)}d old, {account.sentToday} sent
            today)
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
    </div>
  );
}
```

- [ ] **Step 4: Update `getSendPlanAction` to accept and filter by `accountIds`**

```typescript
import { buildSendPlan, toPlannerAccount } from "@/services/send-planner";

const sendPlanSchema = z.object({
  recipientCount: z.number().int().min(0),
  hasPersonalization: z.boolean(),
  accountIds: z.array(z.string()).default([]),
});

export async function getSendPlanAction(input: z.infer<typeof sendPlanSchema>) {
  const session = await requireSession();
  const { recipientCount, hasPersonalization, accountIds } = sendPlanSchema.parse(input);
  const allAccounts = await listSmtpAccounts(session.user.id);
  const selected = allAccounts.filter((a) => accountIds.includes(a.id)).map(toPlannerAccount);
  return buildSendPlan(recipientCount, selected, { hasPersonalization });
}
```
(An account the user unchecked is simply absent from `selected`, so `buildSendPlan` never allocates to it — same effect as if it were inactive, but scoped to this one campaign instead of a permanent state change.)

- [ ] **Step 5: Wire `<SendPlanPanel>` into `campaign-card.tsx`**

Add above the existing Send button:
```typescript
const hasPersonalization = /\{(name|business ?name|owner|owner ?name|first ?name|fname)\}/i.test(
  subject + body,
);
const [resolvedAccountIds, setResolvedAccountIds] = useState<string[]>([]);
// ...
<SendPlanPanel
  recipientCount={recipients.length}
  hasPersonalization={hasPersonalization}
  onAccountsResolved={setResolvedAccountIds}
/>
```
Pass `resolvedAccountIds` into the existing send-campaign call (wired fully in Task 7) as the `accountIds` the campaign actually gets created with — so what you see checked in the panel is exactly what gets used to send, not just a preview.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: only errors remaining should be about `createAndStartCampaignAction`'s signature not yet accepting `accountIds` (fixed next task).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Show the send plan with manual per-account selection before sending"
```

---

### Task 7: Snapshot account + send day onto each `CampaignRecipient`

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `services/campaign-service.ts`
- Modify: `actions/campaign-actions.ts`

- [ ] **Step 1: Add `smtpAccountId` and `scheduledFor` to `CampaignRecipient`**

```prisma
model CampaignRecipient {
  id            String                  @id @default(cuid())
  campaignId    String
  recipientId   String
  smtpAccountId String?
  scheduledFor  DateTime                @default(now())
  name          String                  @default("")
  ownerName     String                  @default("")
  status        CampaignRecipientStatus @default(pending)
  sentAt        DateTime?
  error         String?

  campaign    Campaign     @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  recipient   Recipient    @relation(fields: [recipientId], references: [id])
  smtpAccount SmtpAccount? @relation(fields: [smtpAccountId], references: [id])
}
```

- [ ] **Step 2: Run the migration**

Run: `cd /home/user/email-campaign-agent && npx prisma migrate dev --name snapshot_send_account_and_day`

- [ ] **Step 3: Update `createCampaign` to accept the resolved plan and assign account + day round-robin**

```typescript
export interface CreateCampaignInput {
  userId: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  recipients: ParsedRecipient[];
  accountAllocations: { accountId: string; count: number }[]; // today's batch, in order
}

export async function createCampaign(input: CreateCampaignInput) {
  const recipients = dedupeRecipients(input.recipients);

  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        userId: input.userId,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        totalCount: recipients.length,
      },
    });

    // Flatten today's per-account allotment into a queue of account IDs,
    // then hand recipients out in order; anything left over is scheduled
    // for tomorrow against the first account again (the runner re-derives
    // the real day-by-day cap each morning via sentToday's daily rollover).
    const accountQueue: string[] = [];
    for (const alloc of input.accountAllocations) {
      for (let i = 0; i < alloc.count; i++) accountQueue.push(alloc.accountId);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < recipients.length; i++) {
      const { email, name, ownerName } = recipients[i];
      const recipient = await tx.recipient.upsert({
        where: { userId_email: { userId: input.userId, email } },
        update: { ...(name ? { name } : {}), ...(ownerName ? { ownerName } : {}) },
        create: { userId: input.userId, email, name, ownerName },
      });

      const isWithinToday = i < accountQueue.length;
      const scheduledFor = isWithinToday
        ? today
        : new Date(today.getTime() + Math.floor(i / Math.max(accountQueue.length, 1)) * 86400000);

      await tx.campaignRecipient.create({
        data: {
          campaignId: campaign.id,
          recipientId: recipient.id,
          name,
          ownerName,
          smtpAccountId: isWithinToday ? accountQueue[i] : accountQueue[i % accountQueue.length],
          scheduledFor,
        },
      });
    }

    return campaign;
  });
}
```

- [ ] **Step 4: Update `createAndStartCampaignAction` to build allocations from the client-selected accounts and today's plan**

```typescript
const createCampaignSchema = z.object({
  subject: z.string().min(1).max(300),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  recipients: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().default(""),
        ownerName: z.string().default(""),
      }),
    )
    .min(1),
  accountIds: z.array(z.string()).min(1, "Select at least one email account to send from"),
});

export async function createAndStartCampaignAction(input: z.infer<typeof createCampaignSchema>) {
  const session = await requireSession();
  if (isRateLimited(`create-campaign:${session.user.id}`)) {
    throw new Error("Too many campaigns started, please slow down");
  }

  const parsed = createCampaignSchema.parse(input);
  const hasPersonalization = /\{(name|business ?name|owner|owner ?name|first ?name|fname)\}/i.test(
    parsed.subject + parsed.bodyHtml,
  );
  // Re-filter to exactly the accounts the user had checked in the SendPlanPanel —
  // never silently fall back to "all active accounts" at send time.
  const allAccounts = await listSmtpAccounts(session.user.id);
  const selectedAccounts = allAccounts.filter((a) => parsed.accountIds.includes(a.id)).map(toPlannerAccount);
  const plan = buildSendPlan(parsed.recipients.length, selectedAccounts, { hasPersonalization });

  const campaign = await createCampaign({
    userId: session.user.id,
    subject: parsed.subject,
    bodyHtml: parsed.bodyHtml,
    bodyText: parsed.bodyText,
    recipients: parsed.recipients,
    accountAllocations: plan.allocations,
  });

  await logAudit(session.user.id, "campaign.create", { type: "campaign", id: campaign.id });
  void startCampaignRunner(campaign.id);

  return { campaignId: campaign.id };
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: remaining errors only in `campaign-runner.ts`/`email-sender.ts` (Task 8–9).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Assign each recipient a specific account + send day at creation"
```

---

### Task 8: `email-sender.ts` resolves per account, not per user

**Files:**
- Modify: `services/email-sender.ts`

- [ ] **Step 1: Replace `getEmailSenderForUser` with `getEmailSenderForAccount`**

```typescript
import { SmtpEmailSender } from "@/services/smtp-sender";
import { getSmtpAccountWithPassword } from "@/services/smtp-service";

export async function getEmailSenderForAccount(accountId: string, userId: string): Promise<EmailSenderPort> {
  const account = await getSmtpAccountWithPassword(accountId, userId);
  if (!account) throw new Error(`SMTP account ${accountId} not found for this user`);

  return new SmtpEmailSender({
    host: account.host,
    port: account.port,
    secure: account.secure,
    username: account.username,
    password: account.password,
    fromEmail: account.fromEmail,
  });
}
```
Delete `getEmailSenderForUser` and the `MockEmailSender`/`EMAIL_SENDER` env-var branch — webmail-only means every send now has a real account backing it, so there's no more "no credentials configured yet" fallback case. (If a dev/test double is still wanted, keep `MockEmailSender`'s class definition but wire it in via a test-only seam instead of a production code path — out of scope for this plan; flag to the user if they want it back.)

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "Resolve the email sender per assigned SmtpAccount"
```

---

### Task 9: `campaign-runner.ts` becomes account-and-day aware

**Files:**
- Modify: `server/campaign-runner.ts`

- [ ] **Step 1: Rewrite the recipient-selection query and sender resolution**

Replace the `next` lookup and sender line:
```typescript
const next = await prisma.campaignRecipient.findFirst({
  where: {
    campaignId,
    status: "pending",
    scheduledFor: { lte: new Date() },
  },
  orderBy: { id: "asc" },
});

if (!next) {
  // Either fully done, or everything remaining is scheduled for a future day.
  const anyFuture = await prisma.campaignRecipient.findFirst({
    where: { campaignId, status: "pending" },
  });
  await prisma.campaign.update({
    where: { id: campaignId },
    data: anyFuture
      ? { status: "paused" } // resumes automatically next time the runner is (re)started for this campaign
      : { status: "completed", completedAt: new Date() },
  });
  return;
}

await prisma.campaignRecipient.update({ where: { id: next.id }, data: { status: "sending" } });

if (!next.smtpAccountId) {
  await prisma.campaignRecipient.update({
    where: { id: next.id },
    data: { status: "failed", error: "No SMTP account assigned to this recipient" },
  });
  continue;
}

const sender = await getEmailSenderForAccount(next.smtpAccountId, campaign.userId);
const recipient = await prisma.recipient.findUniqueOrThrow({ where: { id: next.recipientId } });
const variables = { businessName: next.name, ownerName: next.ownerName };

const result = await sender.send(campaign.userId, {
  to: recipient.email,
  subject: renderTemplate(campaign.subject, variables),
  bodyHtml: renderTemplate(campaign.bodyHtml, variables) + signatureHtml,
  bodyText: campaign.bodyText ? renderTemplate(campaign.bodyText, variables) + signatureText : undefined,
});

if (result.success) {
  await incrementSentToday(next.smtpAccountId);
}
```
(Remove the old single `sender = getEmailSenderForUser(...)` line from before the `while (true)` loop entirely — sender is now resolved per-recipient, since different recipients may be assigned to different accounts.)

Import `incrementSentToday` from `@/services/smtp-service` and `getEmailSenderForAccount` from `@/services/email-sender`.

- [ ] **Step 2: A future day's recipients need something to wake the runner back up**

Add a lightweight cron-style trigger: a new file `app/api/campaigns/resume-scheduled/route.ts` that finds any `paused` campaign with a `CampaignRecipient` whose `scheduledFor <= now`, and calls `startCampaignRunner` for it:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";
import { startCampaignRunner } from "@/server/campaign-runner";

export async function GET() {
  const due = await prisma.campaign.findMany({
    where: {
      status: "paused",
      recipients: { some: { status: "pending", scheduledFor: { lte: new Date() } } },
    },
    select: { id: true },
  });

  for (const campaign of due) {
    void startCampaignRunner(campaign.id);
  }

  return NextResponse.json({ resumed: due.length });
}
```
Note: this needs an external trigger (a daily visit, or a `send_later`/cron ping) to actually run — flag to the user that a truly "set and forget" multi-day campaign needs something hitting this route once a day (e.g. a Routine/cron job), and ask whether they want that wired up now or handled manually by revisiting the app each day.

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit && npx vitest run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Make the campaign runner account- and send-day-aware"
```

---

### Task 10: Cleanup pass

**Files:**
- Modify: `.env.example`, `README.md` (if present), `package.json`

- [ ] **Step 1: Remove now-dead env vars from `.env.example`**

Delete `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_SENDER`, `AUTH_URL`/`AUTH_SECRET` if next-auth is fully gone and nothing else reads them — grep first to confirm: `grep -rn "AUTH_SECRET\|AUTH_URL" --include="*.ts" --include="*.tsx" /home/user/email-campaign-agent --exclude-dir=node_modules`.

- [ ] **Step 2: Full verification pass**

Run:
```bash
cd /home/user/email-campaign-agent
npx tsc --noEmit
npx vitest run
npx eslint .
npm run build
```
Expected: all clean, production build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Clean up dead OAuth env vars after webmail-only migration"
```

---

### Task 11: "Starting from zero" volume calculator

**Files:**
- Create: `services/rollout-planner.ts`
- Test: `tests/rollout-planner.test.ts`
- Create: `components/campaign/rollout-planner-panel.tsx`
- Modify: `actions/campaign-actions.ts` (add `planRolloutAction`)
- Modify: `app/settings/page.tsx` (render the new panel)

This is the hypothetical "if I want to send N emails total, how many accounts and domains do I need, and how long will it take" calculator — independent of whatever's currently connected, purely a planning tool.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { planNewRollout } from "@/services/rollout-planner";

describe("planNewRollout", () => {
  it("reaches the target recipient count within its own timeline", () => {
    const plan = planNewRollout(500);
    expect(plan.accountsNeeded).toBeGreaterThanOrEqual(1);
    expect(plan.timeline[plan.timeline.length - 1].cumulativeCapacity).toBeGreaterThanOrEqual(500);
  });

  it("needs at least as many accounts for a much larger target", () => {
    const small = planNewRollout(500);
    const large = planNewRollout(50000);
    expect(large.accountsNeeded).toBeGreaterThanOrEqual(small.accountsNeeded);
  });

  it("derives domainsNeeded from accountsNeeded and mailboxesPerDomain", () => {
    const plan = planNewRollout(50000, { mailboxesPerDomain: 4 });
    expect(plan.domainsNeeded).toBe(Math.ceil(plan.accountsNeeded / 4));
  });

  it("respects an explicit account count instead of searching for the minimum", () => {
    const plan = planNewRollout(1000, { maxAccounts: 3 });
    expect(plan.accountsNeeded).toBe(3);
  });

  it("produces a non-decreasing cumulative capacity timeline", () => {
    const plan = planNewRollout(2000);
    for (let i = 1; i < plan.timeline.length; i++) {
      expect(plan.timeline[i].cumulativeCapacity).toBeGreaterThanOrEqual(
        plan.timeline[i - 1].cumulativeCapacity,
      );
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/rollout-planner.test.ts`
Expected: FAIL — `Cannot find module '@/services/rollout-planner'`

- [ ] **Step 3: Implement `services/rollout-planner.ts`**

```typescript
import { DEFAULT_RAMP_SCHEDULE, capForAge, type RampStep } from "@/services/send-planner";

// Guideline ceiling: putting too many cold-outreach mailboxes on one domain
// risks the *domain's* reputation regardless of individual mailbox health.
const DEFAULT_MAILBOXES_PER_DOMAIN = 4;
const MAX_HORIZON_DAYS = 90;
const MAX_ACCOUNTS_TO_TRY = 50;

export interface RolloutOptions {
  mailboxesPerDomain?: number;
  maxAccounts?: number; // if set, skips the search and just projects this account count
  schedule?: RampStep[];
}

export interface RolloutPlan {
  accountsNeeded: number;
  domainsNeeded: number;
  timeline: { day: number; cumulativeCapacity: number }[];
}

function cumulativeTimelineFor(
  accounts: number,
  totalRecipients: number,
  schedule: RampStep[],
): { day: number; cumulativeCapacity: number }[] {
  const timeline: { day: number; cumulativeCapacity: number }[] = [];
  let cumulative = 0;
  for (let day = 0; day < MAX_HORIZON_DAYS; day++) {
    cumulative += capForAge(day, schedule) * accounts;
    timeline.push({ day, cumulativeCapacity: cumulative });
    if (cumulative >= totalRecipients) break;
  }
  return timeline;
}

/**
 * Computes how many brand-new accounts (all starting today) and domains
 * you'd need to safely clear `totalRecipients`, plus the day-by-day
 * cumulative capacity as they ramp up. Pure function — no I/O.
 */
export function planNewRollout(totalRecipients: number, options: RolloutOptions = {}): RolloutPlan {
  const mailboxesPerDomain = options.mailboxesPerDomain ?? DEFAULT_MAILBOXES_PER_DOMAIN;
  const schedule = options.schedule ?? DEFAULT_RAMP_SCHEDULE;

  let accountsNeeded = options.maxAccounts ?? 1;
  if (!options.maxAccounts) {
    while (accountsNeeded < MAX_ACCOUNTS_TO_TRY) {
      const timeline = cumulativeTimelineFor(accountsNeeded, totalRecipients, schedule);
      if (timeline[timeline.length - 1].cumulativeCapacity >= totalRecipients) break;
      accountsNeeded++;
    }
  }

  return {
    accountsNeeded,
    domainsNeeded: Math.ceil(accountsNeeded / mailboxesPerDomain),
    timeline: cumulativeTimelineFor(accountsNeeded, totalRecipients, schedule),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/rollout-planner.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add the server action**

```typescript
// in actions/campaign-actions.ts
import { planNewRollout } from "@/services/rollout-planner";

const rolloutPlanSchema = z.object({ totalRecipients: z.number().int().min(1) });

export async function planRolloutAction(input: z.infer<typeof rolloutPlanSchema>) {
  await requireSession();
  const { totalRecipients } = rolloutPlanSchema.parse(input);
  return planNewRollout(totalRecipients);
}
```

- [ ] **Step 6: Build the panel**

```typescript
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { planRolloutAction } from "@/actions/campaign-actions";
import type { RolloutPlan } from "@/services/rollout-planner";

export function RolloutPlannerPanel() {
  const [totalRecipients, setTotalRecipients] = useState("");
  const [plan, setPlan] = useState<RolloutPlan | null>(null);

  async function handleCalculate() {
    const n = Number(totalRecipients);
    if (!n || n < 1) return;
    setPlan(await planRolloutAction({ totalRecipients: n }));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        "If I want to send this many emails total, starting from zero, how many accounts and domains
        do I need?" — assumes every account is brand new today.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="Total emails to send"
          value={totalRecipients}
          onChange={(e) => setTotalRecipients(e.target.value)}
        />
        <Button size="sm" onClick={handleCalculate}>
          Calculate
        </Button>
      </div>
      {plan && (
        <div className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-300">
          <p>Accounts needed: {plan.accountsNeeded}</p>
          <p>Domains needed (~4 mailboxes/domain): {plan.domainsNeeded}</p>
          <p>Days to clear at that pace: {plan.timeline.length}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Render it in `app/settings/page.tsx`** as its own card, and typecheck

Run: `npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add the starting-from-zero volume/domain calculator"
```

---

### Task 12: Domain-age detection (best-effort WHOIS suggestion)

**⚠ Before executing this task**: this adds a new dependency (`whois-json`) and makes outbound WHOIS network calls (port 43, not HTTPS) to third-party registrar servers — confirm you're fine with that network behavior before building it. It is explicitly a *suggestion to review and confirm*, not an authoritative fact: it detects the **domain's** registration date, not the mailbox's actual creation date, and many registrars redact this behind privacy protection, in which case it'll say so and ask for manual entry.

**Files:**
- Create: `services/domain-age-service.ts`
- Test: `tests/domain-age-service.test.ts` (pure date-parsing logic only, not the live network call)
- Modify: `actions/settings-actions.ts` (add `detectDomainAgeAction`)
- Modify: `components/campaign/smtp-account-form.tsx` (add a "Detect from domain" button)

- [ ] **Step 1: Install the WHOIS package**

Run: `cd /home/user/email-campaign-agent && npm install whois-json`

- [ ] **Step 2: Write the failing test for the pure parsing helper**

```typescript
import { describe, it, expect } from "vitest";
import { parseWhoisDate } from "@/services/domain-age-service";

describe("parseWhoisDate", () => {
  it("parses a valid date string from a WHOIS record", () => {
    const parsed = parseWhoisDate("2020-01-15T00:00:00Z");
    expect(parsed?.getFullYear()).toBe(2020);
  });

  it("returns null for missing or unparseable input", () => {
    expect(parseWhoisDate(undefined)).toBeNull();
    expect(parseWhoisDate("not-a-date")).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/domain-age-service.test.ts`
Expected: FAIL — `Cannot find module '@/services/domain-age-service'`

- [ ] **Step 4: Implement `services/domain-age-service.ts`**

```typescript
import whois from "whois-json";

export interface DomainAgeResult {
  domain: string;
  registeredAt: Date | null;
  ageDays: number | null;
  confidence: "found" | "unavailable";
}

/** Pure — parses whatever date-ish string a WHOIS record returned, or null if unusable. */
export function parseWhoisDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Best-effort domain age via public WHOIS. This is the DOMAIN's registration
 * date, not the mailbox's actual creation date — use as a starting
 * suggestion to confirm/override, never as ground truth. Many registrars
 * redact this via privacy protection, in which case confidence is
 * "unavailable" and the caller should fall back to manual entry.
 */
export async function detectDomainAge(domain: string): Promise<DomainAgeResult> {
  try {
    const data = (await whois(domain)) as Record<string, string | undefined>;
    const raw = data.creationDate ?? data.createdDate ?? data.registered;
    const registeredAt = parseWhoisDate(raw);

    if (!registeredAt) {
      return { domain, registeredAt: null, ageDays: null, confidence: "unavailable" };
    }

    const ageDays = Math.floor((Date.now() - registeredAt.getTime()) / 86400000);
    return { domain, registeredAt, ageDays, confidence: "found" };
  } catch {
    return { domain, registeredAt: null, ageDays: null, confidence: "unavailable" };
  }
}
```

- [ ] **Step 5: Run to verify the parsing test passes**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/domain-age-service.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 6: Add the server action**

```typescript
// in actions/settings-actions.ts
import { detectDomainAge } from "@/services/domain-age-service";

const detectDomainAgeSchema = z.object({ email: z.string().email() });

export async function detectDomainAgeAction(input: z.infer<typeof detectDomainAgeSchema>) {
  await requireSession();
  const { email } = detectDomainAgeSchema.parse(input);
  const domain = email.split("@")[1];
  return detectDomainAge(domain);
}
```

- [ ] **Step 7: Add the "Detect from domain" button to `smtp-account-form.tsx`**

Add below the `fromEmail` input:
```typescript
const [detecting, setDetecting] = useState(false);
const [detectNote, setDetectNote] = useState<string | null>(null);

async function handleDetect() {
  if (!fromEmail.includes("@")) return;
  setDetecting(true);
  setDetectNote(null);
  const result = await detectDomainAgeAction({ email: fromEmail });
  if (result.confidence === "found" && result.registeredAt) {
    setMailboxAgeStartDate(new Date(result.registeredAt).toISOString().slice(0, 10));
    setDetectNote(
      `Estimated from domain registration (${result.ageDays} days old) — adjust if the mailbox ` +
        `itself is newer than the domain.`,
    );
  } else {
    setDetectNote("Couldn't detect this domain's age (often privacy-protected) — enter it manually.");
  }
  setDetecting(false);
}
// ...
<Button type="button" size="sm" variant="outline" onClick={handleDetect} disabled={detecting}>
  {detecting ? "Checking…" : "Detect from domain"}
</Button>
{detectNote && <p className="text-xs text-zinc-500">{detectNote}</p>}
```
(Import `detectDomainAgeAction` from `@/actions/settings-actions`.)

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit`
```bash
git add -A
git commit -m "Add best-effort domain-age detection via WHOIS to the account form"
```

---

### Task 13: Capacity timeline for your *actual* connected accounts

**Files:**
- Modify: `services/send-planner.ts` (add `projectAccountCapacityTimeline`)
- Modify: `tests/send-planner.test.ts`
- Create: `components/campaign/capacity-timeline-panel.tsx`
- Modify: `actions/campaign-actions.ts` (add `projectCapacityTimelineAction`)
- Modify: `app/settings/page.tsx`

This is the other calculator: not hypothetical new accounts, but "given the accounts I actually have right now, and their real ages, how many days until I can safely clear N recipients."

- [ ] **Step 1: Write the failing tests**

```typescript
// append to tests/send-planner.test.ts
import { projectAccountCapacityTimeline } from "@/services/send-planner";

describe("projectAccountCapacityTimeline", () => {
  it("grows daily capacity as an account ages into the next ramp bracket", () => {
    const accounts = [{ id: "a", label: "A", ageDays: 0, dailyCapOverride: undefined, sentToday: 0, isActive: true }];
    const projection = projectAccountCapacityTimeline(accounts, 100000, 10);
    expect(projection.dailyCapacityByDay[0]).toBe(10); // today, age 0 -> cap 10
    expect(projection.dailyCapacityByDay[4]).toBe(25); // 4 days from now, age 4 -> cap 25
  });

  it("reports days until enough cumulative capacity to clear the list", () => {
    const accounts = [{ id: "a", label: "A", ageDays: 90, dailyCapOverride: undefined, sentToday: 0, isActive: true }];
    const projection = projectAccountCapacityTimeline(accounts, 250, 10);
    expect(projection.daysToClear).toBe(3); // 100+100+100=300 >= 250 by the 3rd day
  });

  it("returns null when the horizon isn't long enough to clear the list", () => {
    const accounts = [{ id: "a", label: "A", ageDays: 90, dailyCapOverride: undefined, sentToday: 0, isActive: true }];
    const projection = projectAccountCapacityTimeline(accounts, 100000, 5);
    expect(projection.daysToClear).toBeNull();
  });

  it("ignores inactive accounts", () => {
    const accounts = [
      { id: "a", label: "A", ageDays: 90, dailyCapOverride: undefined, sentToday: 0, isActive: false },
      { id: "b", label: "B", ageDays: 90, dailyCapOverride: undefined, sentToday: 0, isActive: true },
    ];
    const projection = projectAccountCapacityTimeline(accounts, 50, 5);
    expect(projection.dailyCapacityByDay[0]).toBe(100); // only B counted
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/send-planner.test.ts`
Expected: FAIL — `projectAccountCapacityTimeline is not a function`

- [ ] **Step 3: Implement it in `services/send-planner.ts`** (append below `buildSendPlan`)

```typescript
export interface CapacityProjection {
  dailyCapacityByDay: number[];
  daysToClear: number | null;
}

/**
 * Projects each active account's daily cap forward (as it ages into higher
 * ramp brackets) and reports how many days until cumulative capacity would
 * clear `recipientCount`, or null if that doesn't happen within `horizonDays`.
 */
export function projectAccountCapacityTimeline(
  accounts: PlannerAccount[],
  recipientCount: number,
  horizonDays = 90,
): CapacityProjection {
  const active = accounts.filter((a) => a.isActive);
  const dailyCapacityByDay: number[] = [];
  let cumulative = 0;
  let daysToClear: number | null = null;

  for (let day = 0; day < horizonDays; day++) {
    const totalToday = active.reduce((sum, a) => {
      const cap = a.dailyCapOverride ?? capForAge(a.ageDays + day);
      return sum + cap;
    }, 0);
    dailyCapacityByDay.push(totalToday);
    cumulative += totalToday;
    if (daysToClear === null && cumulative >= recipientCount) {
      daysToClear = day + 1;
    }
  }

  return { dailyCapacityByDay, daysToClear };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/send-planner.test.ts`
Expected: PASS — 13 tests total in this file.

- [ ] **Step 5: Add the server action**

```typescript
// in actions/campaign-actions.ts
import { projectAccountCapacityTimeline } from "@/services/send-planner";

const capacityTimelineSchema = z.object({ recipientCount: z.number().int().min(1) });

export async function projectCapacityTimelineAction(input: z.infer<typeof capacityTimelineSchema>) {
  const session = await requireSession();
  const { recipientCount } = capacityTimelineSchema.parse(input);
  const accounts = (await listSmtpAccounts(session.user.id)).map(toPlannerAccount);
  return projectAccountCapacityTimeline(accounts, recipientCount);
}
```

- [ ] **Step 6: Build the panel**

```typescript
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { projectCapacityTimelineAction } from "@/actions/campaign-actions";
import type { CapacityProjection } from "@/services/send-planner";

export function CapacityTimelinePanel() {
  const [recipientCount, setRecipientCount] = useState("");
  const [projection, setProjection] = useState<CapacityProjection | null>(null);

  async function handleCalculate() {
    const n = Number(recipientCount);
    if (!n || n < 1) return;
    setProjection(await projectCapacityTimelineAction({ recipientCount: n }));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        Using your actual connected accounts and their real ages: how long until you could safely
        clear a list of this size?
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="Recipient count"
          value={recipientCount}
          onChange={(e) => setRecipientCount(e.target.value)}
        />
        <Button size="sm" onClick={handleCalculate}>
          Calculate
        </Button>
      </div>
      {projection && (
        <p className="text-sm text-zinc-300">
          {projection.daysToClear
            ? `You could clear this in ~${projection.daysToClear} days with your current accounts.`
            : "This exceeds what your current accounts can safely clear within 90 days — connect more accounts or reduce the list."}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Render both new panels in `app/settings/page.tsx`**, typecheck, and commit

Run: `npx tsc --noEmit && npx vitest run`
```bash
git add -A
git commit -m "Add capacity timeline projection using real connected account ages"
```

---

### Task 14: IMAP infrastructure + bounce detection

**Files:**
- Modify: `prisma/schema.prisma` (IMAP fields on `SmtpAccount`; `bouncedAt`/`bounceReason`/`sentMessageId` on `CampaignRecipient`)
- Modify: `services/smtp-service.ts` (IMAP fields in CRUD)
- Modify: `components/campaign/smtp-account-form.tsx` (IMAP host/port fields)
- Modify: `services/smtp-sender.ts` (return the `messageId` nodemailer generates)
- Modify: `server/campaign-runner.ts` (store `sentMessageId`)
- Create: `services/imap-service.ts`
- Create: `services/bounce-detector.ts`
- Test: `tests/bounce-detector.test.ts`
- Create: `server/inbox-poller.ts`
- Create: `app/api/campaigns/poll-inbox/route.ts`

**Bounces arrive as a plain email to your own inbox** — reading them requires IMAP (read access), a different protocol from SMTP (send-only), so every account needs IMAP credentials too. Most webmail providers use the same username/password for both, just a different port (587/465 for SMTP, 993 for IMAP) — defaulting IMAP host to the same host as SMTP is a reasonable starting guess, overridable.

- [x] **Step 1: Add IMAP fields to `SmtpAccount`, and outcome-tracking fields to `CampaignRecipient`**

```prisma
model SmtpAccount {
  // ...existing fields from Task 2...
  imapHost          String?
  imapPort          Int      @default(993)
  imapSecure        Boolean  @default(true)
  lastInboxCheckAt  DateTime?
}

model CampaignRecipient {
  // ...existing fields from Tasks 2/7...
  sentMessageId String?
  bouncedAt     DateTime?
  bounceReason  String?
  repliedAt     DateTime?
}

model Campaign {
  // ...existing fields...
  bouncedCount Int @default(0)
  repliedCount Int @default(0)
}
```

- [x] **Step 2: Run the migration**

Run: `cd /home/user/email-campaign-agent && npx prisma migrate dev --name add_imap_and_outcome_tracking`

- [x] **Step 3: Install IMAP + mail-parsing libraries**

Run: `cd /home/user/email-campaign-agent && npm install imapflow mailparser && npm install -D @types/mailparser`

- [x] **Step 4: Write the failing bounce-detector tests**

```typescript
import { describe, it, expect } from "vitest";
import { detectBounce } from "@/services/bounce-detector";

describe("detectBounce", () => {
  it("recognizes a standard DSN-format bounce and extracts the failed recipient", () => {
    const result = detectBounce({
      from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      subject: "Delivery Status Notification (Failure)",
      bodyText:
        "Delivery to the following recipient failed permanently:\n\n" +
        "john@doesnotexist.acme.com\n\n" +
        "Final-Recipient: rfc822; john@doesnotexist.acme.com\n" +
        "Action: failed\n" +
        "Status: 5.1.1",
    });
    expect(result.isBounce).toBe(true);
    expect(result.failedRecipient).toBe("john@doesnotexist.acme.com");
  });

  it("recognizes a 'returned to sender' style bounce", () => {
    const result = detectBounce({
      from: "postmaster@example.com",
      subject: "Undelivered Mail Returned to Sender",
      bodyText: "The original message was received...\n\nFinal-Recipient: rfc822; jane@bad-domain.test",
    });
    expect(result.isBounce).toBe(true);
    expect(result.failedRecipient).toBe("jane@bad-domain.test");
  });

  it("does not flag a normal reply as a bounce", () => {
    const result = detectBounce({
      from: "jim@arborclimb.com.au",
      subject: "Re: Saw your business doesn't have a website yet",
      bodyText: "Thanks for reaching out, yes let's talk.",
    });
    expect(result.isBounce).toBe(false);
    expect(result.failedRecipient).toBeUndefined();
  });

  it("flags a bounce-like subject even without a parseable DSN body, with no recipient extracted", () => {
    const result = detectBounce({
      from: "mailer-daemon@somehost.com",
      subject: "Mail delivery failed: returning message to sender",
      bodyText: "This is a plain-text bounce with no machine-readable recipient field.",
    });
    expect(result.isBounce).toBe(true);
    expect(result.failedRecipient).toBeUndefined();
  });
});
```

- [x] **Step 5: Run to verify it fails**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/bounce-detector.test.ts`
Expected: FAIL — `Cannot find module '@/services/bounce-detector'`

- [x] **Step 6: Implement `services/bounce-detector.ts`**

```typescript
export interface InboundMessage {
  from: string;
  subject: string;
  bodyText: string;
}

export interface BounceResult {
  isBounce: boolean;
  failedRecipient?: string;
}

const BOUNCE_SENDER_PATTERN = /mailer-daemon|postmaster|mail delivery subsystem/i;
const BOUNCE_SUBJECT_PATTERN =
  /undelivered|delivery status notification|delivery failed|returned to sender|failure notice/i;
const FINAL_RECIPIENT_PATTERN = /final-recipient:\s*rfc822;\s*([^\s,]+@[^\s,]+)/i;

/**
 * Classifies an inbound message as a bounce notification (or not) and, when
 * the body follows the standard DSN format (RFC 3464's Final-Recipient
 * field), extracts the address that actually failed. Many real-world
 * bounces aren't in strict DSN format, in which case isBounce is still
 * true (the sender/subject pattern is a strong enough signal on its own)
 * but failedRecipient is left undefined rather than guessed at.
 */
export function detectBounce(message: InboundMessage): BounceResult {
  const looksLikeBounce =
    BOUNCE_SENDER_PATTERN.test(message.from) || BOUNCE_SUBJECT_PATTERN.test(message.subject);

  if (!looksLikeBounce) {
    return { isBounce: false };
  }

  const match = message.bodyText.match(FINAL_RECIPIENT_PATTERN);
  return { isBounce: true, failedRecipient: match?.[1] };
}
```

- [x] **Step 7: Run to verify it passes**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/bounce-detector.test.ts`
Expected: PASS — 4 tests.

- [x] **Step 8: Capture and store `sentMessageId` when sending**

In `services/smtp-sender.ts`, extend the return type and capture nodemailer's real `messageId`:
```typescript
export interface SendResult {
  success: boolean;
  error?: string;
  messageId?: string;
}
// ...
async send(_userId: string, message: OutgoingEmail): Promise<SendResult> {
  try {
    const transporter = nodemailer.createTransport({ /* ...unchanged... */ });
    const info = await transporter.sendMail({ /* ...unchanged... */ });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown SMTP error" };
  }
}
```

In `server/campaign-runner.ts`, store it on the successful-send update:
```typescript
await prisma.campaignRecipient.update({
  where: { id: next.id },
  data: {
    status: result.success ? "sent" : "failed",
    sentAt: new Date(),
    error: result.error,
    sentMessageId: result.messageId,
  },
});
```

- [x] **Step 9: Build `services/imap-service.ts`**

```typescript
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface FetchedMessage {
  from: string;
  subject: string;
  bodyText: string;
  references: string[];
  inReplyTo: string | null;
}

/**
 * Connects to an account's inbox and returns every message received since
 * `since`. Opens and closes the connection per call — this runs on a slow
 * poll cadence (every few minutes at most), not per-recipient, so
 * connection reuse isn't worth the complexity here.
 */
export async function fetchMessagesSince(
  config: { host: string; port: number; secure: boolean; username: string; password: string },
  since: Date,
): Promise<FetchedMessage[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
    logger: false,
  });

  const messages: FetchedMessage[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const message of client.fetch({ since }, { source: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        messages.push({
          from: parsed.from?.text ?? "",
          subject: parsed.subject ?? "",
          bodyText: parsed.text ?? "",
          references: Array.isArray(parsed.references)
            ? parsed.references
            : parsed.references
              ? [parsed.references]
              : [],
          inReplyTo: parsed.inReplyTo ?? null,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return messages;
}
```

- [x] **Step 10: Build `server/inbox-poller.ts`**

```typescript
import { prisma } from "@/database/prisma";
import { fetchMessagesSince } from "@/services/imap-service";
import { detectBounce } from "@/services/bounce-detector";
import { detectReply } from "@/services/reply-detector";
import { getSmtpAccountWithPassword } from "@/services/smtp-service";

/**
 * Polls every IMAP-configured account for new inbox messages since its last
 * check, classifies each as a bounce or reply, and updates the matching
 * CampaignRecipient row. Meant to be triggered periodically by an external
 * ping (see app/api/campaigns/poll-inbox/route.ts) — same constraint as the
 * multi-day campaign resume in Task 9.
 */
export async function pollAllInboxes(): Promise<{ checked: number; bounces: number; replies: number }> {
  const accounts = await prisma.smtpAccount.findMany({
    where: { imapHost: { not: null }, isActive: true },
  });

  let bounces = 0;
  let replies = 0;

  for (const account of accounts) {
    const full = await getSmtpAccountWithPassword(account.id, account.userId);
    if (!full || !full.imapHost) continue;

    const since = account.lastInboxCheckAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const messages = await fetchMessagesSince(
      {
        host: full.imapHost,
        port: full.imapPort,
        secure: full.imapSecure,
        username: full.username,
        password: full.password,
      },
      since,
    );

    for (const message of messages) {
      const bounce = detectBounce(message);
      if (bounce.isBounce && bounce.failedRecipient) {
        const matches = await prisma.campaignRecipient.findMany({
          where: {
            smtpAccountId: account.id,
            status: "sent",
            bouncedAt: null,
            recipient: { email: bounce.failedRecipient },
          },
          select: { id: true, campaignId: true },
        });

        for (const match of matches) {
          await prisma.campaignRecipient.update({
            where: { id: match.id },
            data: { bouncedAt: new Date(), bounceReason: "Bounced (detected via inbox scan)" },
          });
          await prisma.campaign.update({
            where: { id: match.campaignId },
            data: { bouncedCount: { increment: 1 } },
          });
          bounces++;
        }
        continue;
      }

      const outstanding = await prisma.campaignRecipient.findMany({
        where: { smtpAccountId: account.id, status: "sent", sentMessageId: { not: null } },
        select: { id: true, sentMessageId: true, campaignId: true },
      });
      const reply = detectReply(message, outstanding);
      if (reply.matchedRecipientId) {
        const matched = outstanding.find((r) => r.id === reply.matchedRecipientId)!;
        await prisma.campaignRecipient.update({
          where: { id: matched.id },
          data: { repliedAt: new Date() },
        });
        await prisma.campaign.update({
          where: { id: matched.campaignId },
          data: { repliedCount: { increment: 1 } },
        });
        replies++;
      }
    }

    await prisma.smtpAccount.update({
      where: { id: account.id },
      data: { lastInboxCheckAt: new Date() },
    });
  }

  return { checked: accounts.length, bounces, replies };
}
```

- [x] **Step 11: Add the trigger route**

```typescript
// app/api/campaigns/poll-inbox/route.ts
import { NextResponse } from "next/server";
import { pollAllInboxes } from "@/server/inbox-poller";

export async function GET() {
  const result = await pollAllInboxes();
  return NextResponse.json(result);
}
```

- [x] **Step 12: Thread IMAP fields through the account CRUD and form**

In `services/smtp-service.ts`, extend `SmtpAccountInput`/`SmtpAccountRecord` and the create/list functions:
```typescript
export interface SmtpAccountInput {
  // ...existing fields from Task 2...
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
}

export interface SmtpAccountRecord extends Omit<SmtpAccountInput, "password"> {
  // ...existing fields from Task 2...
}

// in listSmtpAccounts, add to the pushed record:
imapHost: row.imapHost,
imapPort: row.imapPort,
imapSecure: row.imapSecure,

// in createSmtpAccount's data object, add:
imapHost: input.imapHost,
imapPort: input.imapPort,
imapSecure: input.imapSecure,
```

In `actions/settings-actions.ts`, extend `smtpAccountSchema`:
```typescript
const smtpAccountSchema = z.object({
  // ...existing fields from Task 3...
  imapHost: z.string().min(1),
  imapPort: z.coerce.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
});
```

In `components/campaign/smtp-account-form.tsx`, add the fields (defaulting `imapHost` to whatever's typed into `host` unless the user overrides it):
```typescript
const [imapHost, setImapHost] = useState("");
const [imapPort, setImapPort] = useState("993");
const [imapSecure, setImapSecure] = useState(true);
// ...
async function handleSave() {
  // ...
  const result = await addSmtpAccountAction({
    // ...existing fields...
    imapHost: imapHost || host,
    imapPort: Number(imapPort),
    imapSecure,
  });
  // ...
}
// ... in the JSX, below the existing SMTP host/port inputs:
<Input
  placeholder="IMAP host (blank = same as SMTP host)"
  value={imapHost}
  onChange={(e) => setImapHost(e.target.value)}
/>
<Input placeholder="IMAP port (993)" value={imapPort} onChange={(e) => setImapPort(e.target.value)} />
```

- [x] **Step 13: Typecheck, test, commit**

Run: `npx tsc --noEmit && npx vitest run`
```bash
git add -A
git commit -m "Add IMAP-based bounce detection"
```

---

### Task 15: Reply detection

**Files:**
- Create: `services/reply-detector.ts`
- Test: `tests/reply-detector.test.ts`

(`server/inbox-poller.ts` from Task 14 already calls `detectReply` — this task fills that module in.)

- [x] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { detectReply } from "@/services/reply-detector";

describe("detectReply", () => {
  it("matches a reply via References header against an outstanding sentMessageId", () => {
    const outstanding = [
      { id: "cr1", sentMessageId: "<abc123@mailpilot>" },
      { id: "cr2", sentMessageId: "<def456@mailpilot>" },
    ];
    const message = {
      from: "jim@arborclimb.com.au",
      subject: "Re: quick question",
      bodyText: "Sure, let's talk.",
      references: ["<abc123@mailpilot>"],
      inReplyTo: null,
    };
    expect(detectReply(message, outstanding).matchedRecipientId).toBe("cr1");
  });

  it("matches via In-Reply-To when References is absent", () => {
    const outstanding = [{ id: "cr1", sentMessageId: "<abc123@mailpilot>" }];
    const message = {
      from: "jim@arborclimb.com.au",
      subject: "Re: quick question",
      bodyText: "Sure.",
      references: [],
      inReplyTo: "<abc123@mailpilot>",
    };
    expect(detectReply(message, outstanding).matchedRecipientId).toBe("cr1");
  });

  it("returns no match when neither header lines up with anything outstanding", () => {
    const outstanding = [{ id: "cr1", sentMessageId: "<abc123@mailpilot>" }];
    const message = {
      from: "someone@else.com",
      subject: "Unrelated",
      bodyText: "Hi",
      references: ["<unrelated@somewhere>"],
      inReplyTo: null,
    };
    expect(detectReply(message, outstanding).matchedRecipientId).toBeUndefined();
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/reply-detector.test.ts`
Expected: FAIL — `Cannot find module '@/services/reply-detector'`

- [x] **Step 3: Implement `services/reply-detector.ts`**

```typescript
import type { FetchedMessage } from "@/services/imap-service";

export interface OutstandingRecipient {
  id: string;
  sentMessageId: string | null;
}

export interface ReplyResult {
  matchedRecipientId?: string;
}

/**
 * Matches an inbound message back to the campaign send it's replying to,
 * via email threading headers (References, then In-Reply-To) against each
 * outstanding recipient's stored sentMessageId. Threading-header matching
 * is used rather than "any inbound mail from that address counts as a
 * reply", since a lead might separately email you about something
 * unrelated — this only counts a genuine reply to the actual sent message.
 */
export function detectReply(message: FetchedMessage, outstanding: OutstandingRecipient[]): ReplyResult {
  const candidateIds = new Set([...message.references, message.inReplyTo].filter(Boolean) as string[]);

  for (const recipient of outstanding) {
    if (recipient.sentMessageId && candidateIds.has(recipient.sentMessageId)) {
      return { matchedRecipientId: recipient.id };
    }
  }

  return {};
}
```

- [x] **Step 4: Run to verify it passes**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/reply-detector.test.ts`
Expected: PASS — 3 tests.

- [x] **Step 5: Surface bounce/reply counts on `app/history/page.tsx`**

This page renders one `Card` per campaign with a row of `Total`/`Delivered`/`Failed` counts inside `CardContent`. Add `Bounced`/`Replied` to that same row, reading the new `bouncedCount`/`repliedCount` fields from Task 14 Step 1:

```typescript
<CardContent className="flex gap-6 text-xs text-zinc-400">
  <span>Total: {c.totalCount}</span>
  <span>Delivered: {c.deliveredCount}</span>
  <span>Failed: {c.failedCount}</span>
  <span>Bounced: {c.bouncedCount}</span>
  <span>Replied: {c.repliedCount}</span>
</CardContent>
```

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "Add reply detection via email threading headers"
```

---

### Task 16 (optional, lower-confidence signal): Open and click tracking

**⚠ Read this before building it**: open tracking via pixel is industry-acknowledged as unreliable — Apple Mail Privacy Protection preloads every tracking pixel for every email regardless of whether a human opened it (massively overcounts), while many other clients block external images by default (undercounts everyone else). Click tracking is far more trustworthy, since it only fires on an actual, deliberate click. Confirm you still want pixel-based open tracking despite the caveat, or consider shipping click tracking alone.

**Files:**
- Modify: `prisma/schema.prisma` (`trackingId`, `openedAt`, `firstClickedAt`, `clickCount` on `CampaignRecipient`)
- Create: `utils/link-tracking.ts`
- Create: `app/api/track/open/[trackingId]/route.ts`
- Create: `app/api/track/click/[trackingId]/route.ts`
- Modify: `server/campaign-runner.ts` (inject the pixel + rewrite links before sending)

- [x] **Step 1: Add tracking fields**

```prisma
model CampaignRecipient {
  // ...existing fields...
  trackingId      String   @unique @default(cuid())
  openedAt        DateTime?
  firstClickedAt  DateTime?
  clickCount      Int       @default(0)
}
```

Run: `cd /home/user/email-campaign-agent && npx prisma migrate dev --name add_open_click_tracking`

- [x] **Step 2: Build `utils/link-tracking.ts`**

```typescript
const ANCHOR_HREF_PATTERN = /<a\s+([^>]*?)href="([^"]+)"([^>]*)>/gi;

/** Rewrites every <a href="..."> in HTML to route through the click-tracking redirect endpoint. */
export function rewriteLinksForTracking(html: string, trackingId: string, baseUrl: string): string {
  return html.replace(ANCHOR_HREF_PATTERN, (match, before, href, after) => {
    if (href.startsWith("mailto:") || href.startsWith("#")) return match;
    const trackedUrl = `${baseUrl}/api/track/click/${trackingId}?url=${encodeURIComponent(href)}`;
    return `<a ${before}href="${trackedUrl}"${after}>`;
  });
}

/** The invisible 1x1 pixel tag appended before the signature. */
export function openTrackingPixel(trackingId: string, baseUrl: string): string {
  return `<img src="${baseUrl}/api/track/open/${trackingId}" width="1" height="1" style="display:none" alt="" />`;
}
```

- [x] **Step 3: Wire it into the send loop**

In `server/campaign-runner.ts`, after rendering `bodyHtml` and appending the signature, before calling `sender.send(...)`:
```typescript
const trackedHtml =
  rewriteLinksForTracking(renderTemplate(campaign.bodyHtml, variables), next.trackingId, process.env.APP_BASE_URL!) +
  signatureHtml +
  openTrackingPixel(next.trackingId, process.env.APP_BASE_URL!);
```
Use `trackedHtml` as the `bodyHtml` passed to `sender.send`. Requires an `APP_BASE_URL` env var set to your public URL (the Cloudflare Tunnel domain or wherever this is actually reachable) — tracking links are meaningless if they don't point somewhere the recipient's email client can actually reach.

- [x] **Step 4: Add the tracking routes**

```typescript
// app/api/track/open/[trackingId]/route.ts
import { prisma } from "@/database/prisma";

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7",
  "base64",
);

export async function GET(_req: Request, { params }: { params: Promise<{ trackingId: string }> }) {
  const { trackingId } = await params;
  await prisma.campaignRecipient.updateMany({
    where: { trackingId, openedAt: null },
    data: { openedAt: new Date() },
  });
  return new Response(PIXEL, { headers: { "Content-Type": "image/gif" } });
}
```

```typescript
// app/api/track/click/[trackingId]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ trackingId: string }> }) {
  const { trackingId } = await params;
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  const recipient = await prisma.campaignRecipient.findUnique({ where: { trackingId } });
  await prisma.campaignRecipient.update({
    where: { trackingId },
    data: {
      firstClickedAt: recipient?.firstClickedAt ?? new Date(),
      clickCount: { increment: 1 },
    },
  });

  return NextResponse.redirect(url);
}
```

- [x] **Step 5: Show open/click counts in the campaign detail view**, typecheck, and commit

Run: `npx tsc --noEmit`
```bash
git add -A
git commit -m "Add optional open/click tracking (click tracking is the reliable one)"
```

---


> **Built as click-tracking only** (user's explicit choice) — the `openedAt` pixel, `app/api/track/open/[trackingId]/route.ts`, and its injection into the send loop were intentionally skipped as unreliable. Only `trackingId`, `firstClickedAt`, `clickCount`, `utils/link-tracking.ts`, and `app/api/track/click/[trackingId]/route.ts` were built.

### Task 17: One-click unsubscribe + `List-Unsubscribe` header

**Files:**
- Modify: `prisma/schema.prisma` (`unsubscribeToken`, `unsubscribedAt` on `Recipient`)
- Create: `services/unsubscribe-service.ts`
- Test: `tests/unsubscribe-service.test.ts`
- Create: `app/api/unsubscribe/[token]/route.ts`
- Modify: `services/email-sender.ts` (add `headers` to `OutgoingEmail`)
- Modify: `services/smtp-sender.ts` (pass `headers` through to nodemailer)
- Modify: `services/campaign-service.ts` (`createCampaign` filters out already-unsubscribed emails, reports how many were skipped)
- Modify: `server/campaign-runner.ts` (attaches the header + visible link to every send; defensively skips if unsubscribed after the campaign was created)
- Modify: `actions/campaign-actions.ts` (surface `skippedUnsubscribed` count to the caller)

- [x] **Step 1: Add the fields**

```prisma
model Recipient {
  // ...existing fields...
  unsubscribeToken String    @unique @default(cuid())
  unsubscribedAt   DateTime?
}
```

Run: `cd /home/user/email-campaign-agent && npx prisma migrate dev --name add_unsubscribe`

- [x] **Step 2: Write the failing test for the pure header-builder**

```typescript
import { describe, it, expect } from "vitest";
import { buildUnsubscribeHeaders } from "@/services/unsubscribe-service";

describe("buildUnsubscribeHeaders", () => {
  it("includes both the https link and List-Unsubscribe-Post for one-click support", () => {
    const headers = buildUnsubscribeHeaders("https://mailpilot.example/api/unsubscribe/abc123");
    expect(headers["List-Unsubscribe"]).toBe("<https://mailpilot.example/api/unsubscribe/abc123>");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
```

- [x] **Step 3: Run to verify it fails**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/unsubscribe-service.test.ts`
Expected: FAIL — `Cannot find module '@/services/unsubscribe-service'`

- [x] **Step 4: Implement `services/unsubscribe-service.ts`**

```typescript
import { prisma } from "@/database/prisma";

/**
 * Builds the RFC 2369 / RFC 8058 headers that let Gmail/Yahoo/Outlook show
 * their own built-in one-click "Unsubscribe" button next to the sender
 * name, which is effectively required at any real volume under their 2024
 * bulk-sender rules.
 */
export function buildUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function markUnsubscribed(token: string): Promise<void> {
  await prisma.recipient.updateMany({
    where: { unsubscribeToken: token, unsubscribedAt: null },
    data: { unsubscribedAt: new Date() },
  });
}

/** Emails (lowercased) among `emails` that are already unsubscribed for this user. */
export async function findUnsubscribedEmails(userId: string, emails: string[]): Promise<Set<string>> {
  const rows = await prisma.recipient.findMany({
    where: { userId, email: { in: emails }, unsubscribedAt: { not: null } },
    select: { email: true },
  });
  return new Set(rows.map((r) => r.email));
}
```

- [x] **Step 5: Run to verify it passes**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/unsubscribe-service.test.ts`
Expected: PASS — 1 test.

- [x] **Step 6: Add the unsubscribe route**

```typescript
import { markUnsubscribed } from "@/services/unsubscribe-service";

async function handle(token: string) {
  await markUnsubscribed(token);
  return new Response(
    "<html><body style=\"font-family:sans-serif;padding:2rem\">" +
      "You've been unsubscribed and won't receive further emails from this sender.</body></html>",
    { headers: { "Content-Type": "text/html" } },
  );
}

// A human clicking the visible link in the email body.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handle(token);
}

// RFC 8058 one-click: mail clients POST here directly with no confirmation
// page - the spec requires this to succeed silently, no further interaction.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handle(token);
}
```

- [x] **Step 7: Add `headers` to the sending pipeline**

In `services/email-sender.ts`:
```typescript
export interface OutgoingEmail {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  headers?: Record<string, string>;
}
```

In `services/smtp-sender.ts`, pass it through:
```typescript
await transporter.sendMail({
  from: this.config.fromEmail,
  to: message.to,
  subject: message.subject,
  html: message.bodyHtml,
  text: message.bodyText,
  headers: message.headers,
});
```

- [x] **Step 8: Filter unsubscribed recipients out of `createCampaign`**

This replaces `createCampaign` from Task 7 Step 3 in full — only the first two lines (deduping, then filtering out unsubscribed emails) and the final return statement are new; the transaction body itself is unchanged from Task 7:

```typescript
import { findUnsubscribedEmails } from "@/services/unsubscribe-service";

export async function createCampaign(input: CreateCampaignInput) {
  const deduped = dedupeRecipients(input.recipients);
  const unsubscribed = await findUnsubscribedEmails(
    input.userId,
    deduped.map((r) => r.email),
  );
  const recipients = deduped.filter((r) => !unsubscribed.has(r.email));
  const skippedUnsubscribed = deduped.filter((r) => unsubscribed.has(r.email)).map((r) => r.email);

  const campaign = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        userId: input.userId,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        totalCount: recipients.length,
      },
    });

    const accountQueue: string[] = [];
    for (const alloc of input.accountAllocations) {
      for (let i = 0; i < alloc.count; i++) accountQueue.push(alloc.accountId);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < recipients.length; i++) {
      const { email, name, ownerName } = recipients[i];
      const recipient = await tx.recipient.upsert({
        where: { userId_email: { userId: input.userId, email } },
        update: { ...(name ? { name } : {}), ...(ownerName ? { ownerName } : {}) },
        create: { userId: input.userId, email, name, ownerName },
      });

      const isWithinToday = i < accountQueue.length;
      const scheduledFor = isWithinToday
        ? today
        : new Date(today.getTime() + Math.floor(i / Math.max(accountQueue.length, 1)) * 86400000);

      await tx.campaignRecipient.create({
        data: {
          campaignId: campaign.id,
          recipientId: recipient.id,
          name,
          ownerName,
          smtpAccountId: isWithinToday ? accountQueue[i] : accountQueue[i % accountQueue.length],
          scheduledFor,
        },
      });
    }

    return campaign;
  });

  return { campaign, skippedUnsubscribed };
}
```
(This changes `createCampaign`'s return shape from `campaign` to `{ campaign, skippedUnsubscribed }` — update `createAndStartCampaignAction` in Step 10 below accordingly, since it's the only caller.)

- [x] **Step 9: Attach the header and visible link at send time in `server/campaign-runner.ts`**

Before building the `sender.send(...)` call, and after fetching `recipient` (already done in Task 9's rewrite):
```typescript
if (recipient.unsubscribedAt) {
  await prisma.campaignRecipient.update({
    where: { id: next.id },
    data: { status: "failed", error: "Recipient unsubscribed" },
  });
  continue;
}

const unsubscribeUrl = `${process.env.APP_BASE_URL}/api/unsubscribe/${recipient.unsubscribeToken}`;
const unsubscribeFooter =
  `<br/><br/><p style="font-size:11px;color:#888">Don't want these emails? ` +
  `<a href="${unsubscribeUrl}">Unsubscribe</a></p>`;

const result = await sender.send(campaign.userId, {
  to: recipient.email,
  subject: renderTemplate(campaign.subject, variables),
  bodyHtml: renderTemplate(campaign.bodyHtml, variables) + signatureHtml + unsubscribeFooter,
  bodyText: campaign.bodyText
    ? renderTemplate(campaign.bodyText, variables) + signatureText + `\n\nUnsubscribe: ${unsubscribeUrl}`
    : undefined,
  headers: buildUnsubscribeHeaders(unsubscribeUrl),
});
```

- [x] **Step 10: Update `createAndStartCampaignAction` for the new return shape**

```typescript
const { campaign, skippedUnsubscribed } = await createCampaign({
  userId: session.user.id,
  subject: parsed.subject,
  bodyHtml: parsed.bodyHtml,
  bodyText: parsed.bodyText,
  recipients: parsed.recipients,
  accountAllocations: plan.allocations,
});

await logAudit(session.user.id, "campaign.create", { type: "campaign", id: campaign.id });
void startCampaignRunner(campaign.id);

return { campaignId: campaign.id, skippedUnsubscribed };
```

- [x] **Step 11: Typecheck, test, commit**

Run: `npx tsc --noEmit && npx vitest run`
```bash
git add -A
git commit -m "Add one-click unsubscribe with List-Unsubscribe/List-Unsubscribe-Post headers"
```

---

### Task 18: Business-hours-aware sending

**Files:**
- Create: `services/sending-window-service.ts`
- Test: `tests/sending-window-service.test.ts`
- Modify: `prisma/schema.prisma` (no new model — reuses the existing `Setting` key-value table, same pattern as the email signature)
- Create: `components/campaign/sending-window-form.tsx`
- Modify: `actions/settings-actions.ts` (save/load the window)
- Modify: `app/settings/page.tsx`
- Modify: `server/campaign-runner.ts` (check the window before each send)

**Scope note**: this can't know an individual recipient's actual location/timezone from just their email address — there's no reliable way to geolocate an arbitrary address. What it *can* do is let you set a single sending window (e.g. "9am–5pm, Mon–Fri, Australia/Brisbane") for your intended audience, and the runner simply won't send outside it. That's the honest, buildable version of "business-hours-aware."

- [x] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { isWithinSendingWindow } from "@/services/sending-window-service";

const window = { startHour: 9, endHour: 17, timezone: "UTC", sendOnWeekends: false };

describe("isWithinSendingWindow", () => {
  it("allows sending during business hours on a weekday", () => {
    // 2026-08-04 is a Tuesday
    expect(isWithinSendingWindow(new Date("2026-08-04T12:00:00Z"), window)).toBe(true);
  });

  it("blocks sending outside business hours", () => {
    expect(isWithinSendingWindow(new Date("2026-08-04T03:00:00Z"), window)).toBe(false);
  });

  it("blocks weekends when sendOnWeekends is false", () => {
    // 2026-08-08 is a Saturday
    expect(isWithinSendingWindow(new Date("2026-08-08T12:00:00Z"), window)).toBe(false);
  });

  it("allows weekends when sendOnWeekends is true", () => {
    expect(isWithinSendingWindow(new Date("2026-08-08T12:00:00Z"), { ...window, sendOnWeekends: true })).toBe(
      true,
    );
  });

  it("respects a non-UTC timezone", () => {
    // 2026-08-04T20:00:00Z = 2026-08-05 06:00 AEST - before the 9am start in that zone
    const aestWindow = { ...window, timezone: "Australia/Brisbane" };
    expect(isWithinSendingWindow(new Date("2026-08-04T20:00:00Z"), aestWindow)).toBe(false);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/sending-window-service.test.ts`
Expected: FAIL — `Cannot find module '@/services/sending-window-service'`

- [x] **Step 3: Implement `services/sending-window-service.ts`**

```typescript
import { prisma } from "@/database/prisma";

export interface SendingWindow {
  startHour: number; // 0-23, inclusive
  endHour: number; // 0-23, exclusive
  timezone: string; // IANA timezone, e.g. "Australia/Brisbane"
  sendOnWeekends: boolean;
}

const DEFAULT_WINDOW: SendingWindow = {
  startHour: 9,
  endHour: 17,
  timezone: "UTC",
  sendOnWeekends: false,
};

const SENDING_WINDOW_KEY = "sending_window";

/** Pure — no I/O. Checks `now` against the window using timezone-aware hour/weekday extraction. */
export function isWithinSendingWindow(now: Date, window: SendingWindow): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: window.timezone,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const isWeekend = weekday === "Sat" || weekday === "Sun";

  if (isWeekend && !window.sendOnWeekends) return false;
  return hour >= window.startHour && hour < window.endHour;
}

export async function getSendingWindow(userId: string): Promise<SendingWindow> {
  const setting = await prisma.setting.findUnique({
    where: { userId_key: { userId, key: SENDING_WINDOW_KEY } },
  });
  return setting?.value ? JSON.parse(setting.value) : DEFAULT_WINDOW;
}

export async function setSendingWindow(userId: string, window: SendingWindow): Promise<void> {
  const value = JSON.stringify(window);
  await prisma.setting.upsert({
    where: { userId_key: { userId, key: SENDING_WINDOW_KEY } },
    update: { value },
    create: { userId, key: SENDING_WINDOW_KEY, value },
  });
}
```

- [x] **Step 4: Run to verify it passes**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/sending-window-service.test.ts`
Expected: PASS — 5 tests.

- [x] **Step 5: Check the window in the send loop**

In `server/campaign-runner.ts`, near the top of the `while (true)` loop, after the existing pause/cancel checks:
```typescript
const window = await getSendingWindow(campaign.userId);
if (!isWithinSendingWindow(new Date(), window)) {
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "paused" } });
  return; // picked back up by the same daily/periodic trigger as Task 9's multi-day resume
}
```
(Fetching the window on every loop iteration keeps it responsive to mid-campaign edits; it's a single indexed `Setting` row lookup, not meaningfully expensive at this send pace of one recipient per 5-10 seconds.)

- [x] **Step 6: Build the Settings form**

```typescript
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveSendingWindowAction } from "@/actions/settings-actions";
import type { SendingWindow } from "@/services/sending-window-service";

export function SendingWindowForm({ initialValue }: { initialValue: SendingWindow }) {
  const [startHour, setStartHour] = useState(String(initialValue.startHour));
  const [endHour, setEndHour] = useState(String(initialValue.endHour));
  const [timezone, setTimezone] = useState(initialValue.timezone);
  const [sendOnWeekends, setSendOnWeekends] = useState(initialValue.sendOnWeekends);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await saveSendingWindowAction({
      startHour: Number(startHour),
      endHour: Number(endHour),
      timezone,
      sendOnWeekends,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        Campaigns pause automatically outside this window and resume once it reopens.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="Start hour (0-23)" value={startHour} onChange={(e) => setStartHour(e.target.value)} />
        <Input placeholder="End hour (0-23)" value={endHour} onChange={(e) => setEndHour(e.target.value)} />
        <Input
          placeholder="Timezone (e.g. Australia/Brisbane)"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="col-span-2"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={sendOnWeekends}
          onChange={(e) => setSendOnWeekends(e.target.checked)}
        />
        Also send on weekends
      </label>
      <Button size="sm" onClick={handleSave}>
        Save
      </Button>
      {saved && <span className="text-xs text-emerald-400">Saved</span>}
    </div>
  );
}
```

- [x] **Step 7: Wire up the action and Settings page**

```typescript
// in actions/settings-actions.ts
import { setSendingWindow, type SendingWindow } from "@/services/sending-window-service";

const sendingWindowSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
  timezone: z.string().min(1),
  sendOnWeekends: z.boolean(),
});

export async function saveSendingWindowAction(input: z.infer<typeof sendingWindowSchema>) {
  const session = await requireSession();
  const parsed = sendingWindowSchema.parse(input) satisfies SendingWindow;
  await setSendingWindow(session.user.id, parsed);
  revalidatePath("/settings");
  return { ok: true };
}
```

In `app/settings/page.tsx`, fetch `getSendingWindow(session.user.id)` alongside the other settings and render a new card with `<SendingWindowForm initialValue={sendingWindow} />`.

- [x] **Step 8: Typecheck, test, commit**

Run: `npx tsc --noEmit && npx vitest run`
```bash
git add -A
git commit -m "Add configurable business-hours sending window"
```

---

### Task 19: Motion, polish, and performance

**Files:**
- Create: `utils/motion.ts`
- Modify: `components/ui/progress.tsx`
- Modify: `components/ui/button.tsx`
- Create: `components/ui/skeleton.tsx`
- Modify: `components/campaign/send-plan-panel.tsx`, `components/campaign/rollout-planner-panel.tsx`, `components/campaign/capacity-timeline-panel.tsx`

**This environment doesn't have the design-system database installed** (only its guideline reference), so the concrete numbers below come directly from that reference rather than a generated palette — durations, easing, and contrast ratios are real, sourced values, not invented.

**Scope decision, stated up front**: the recipient chip list (`recipient-dump.tsx`) stays un-animated per-item. It's virtualized via `@tanstack/react-virtual`, which recycles DOM nodes at fixed computed positions — layering enter/exit/stagger animation on top of that risks visual glitches (recycled nodes replaying animations, momentarily wrong positions) for a dense data list where that kind of delight isn't the point. Animation effort goes where it's actually safe and valuable: panels, buttons, and the progress bar below.

- [x] **Step 1: Shared motion tokens**

```typescript
import type { Variants, Transition } from "framer-motion";

/** One shared rhythm for every animation in the app - durations in the 150-300ms
 * micro-interaction range, exit faster than enter (~65%) so dismissal feels snappy. */
export const MOTION_DURATION = {
  fast: 0.15,
  base: 0.2,
} as const;

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN = [0.7, 0, 0.84, 0] as const;

/** Panels fade + rise slightly on enter, fade out faster on exit. */
export const panelVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: MOTION_DURATION.base, ease: EASE_OUT } },
  exit: { opacity: 0, y: 4, transition: { duration: MOTION_DURATION.fast, ease: EASE_IN } },
};

export const progressBarTransition: Transition = { duration: 0.5, ease: EASE_OUT };
```

- [x] **Step 2: Fix the progress bar to animate via `transform: scaleX` instead of `width`**

The current `components/ui/progress.tsx` animates the literal `width` CSS property via `transition-all duration-500` — this forces a layout recalculation on every update. Rewrite it to animate a GPU-composited `scaleX` transform instead, which never triggers layout:

```typescript
"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { progressBarTransition } from "@/utils/motion";

export function Progress({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value)) / 100;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-zinc-800", className)}>
      <motion.div
        className="h-full w-full origin-left rounded-full bg-emerald-500"
        initial={false}
        animate={{ scaleX: clamped }}
        transition={progressBarTransition}
      />
    </div>
  );
}
```
(`origin-left` keeps the scale anchored to the left edge, so it visually grows left-to-right exactly like the old width-based version — but composited on the GPU instead of triggering layout.)

- [x] **Step 3: Press/hover feedback on the shared Button**

The current `buttonVariants` base class is `"...transition-colors..."`, which only transitions color-related properties — adding a press-scale effect needs `transform` included in the transitioned properties, or the scale will snap instead of animate. Change the base class:

```typescript
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium " +
    "transition-[color,background-color,transform] duration-150 active:scale-[0.97] " +
    "disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
  {
    // ...variants/sizes/defaultVariants unchanged...
  },
);
```

- [x] **Step 4: A shared skeleton for the calculator panels' loading states**

The rollout-planner, capacity-timeline, and send-plan panels all call a server action and briefly show nothing while it resolves. Per the loading-states guideline (skeleton over blocking spinner for anything that might exceed ~300ms), add:

```typescript
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-zinc-800", className)} />;
}
```

- [x] **Step 5: Wire panel enter/exit motion + loading skeletons into the three calculator panels**

In `components/campaign/send-plan-panel.tsx`, wrap the existing returned JSX in `AnimatePresence`/`motion.div` and add a loading skeleton while `plan` hasn't resolved yet:

```typescript
import { motion, AnimatePresence } from "framer-motion";
import { panelVariants } from "@/utils/motion";
import { Skeleton } from "@/components/ui/skeleton";
// ...
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
      {/* ...existing checkbox list and plan/warnings rendering unchanged... */}
      {!plan && recipientCount > 0 && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
    </motion.div>
  </AnimatePresence>
);
```

Apply the identical pattern (import, `AnimatePresence`/`motion.div` wrapper with `panelVariants`, a `Skeleton` shown while its own `plan`/`projection` state is `null` and a calculation is in flight) to `rollout-planner-panel.tsx` and `capacity-timeline-panel.tsx` — same three-line wrapper, different inner content, since all three share the exact same "empty → calculating → result" shape.

- [x] **Step 6: Typecheck, and manually verify in the browser**

Run: `npx tsc --noEmit`

Then actually load the app and: (a) toggle a `SendPlanPanel` checkbox and confirm the panel doesn't jump/flicker, (b) watch a campaign's progress bar advance and confirm it's smooth, (c) enable "reduce motion" in your OS accessibility settings and confirm framer-motion respects it (it does automatically via its built-in `useReducedMotion` detection — no extra code needed, but verify rather than assume).

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "Add motion tokens, transform-based progress bar, and skeleton loading states"
```

---

## Open questions to resolve with the user before/while executing

1. **Multi-day auto-resume** (Task 9), **inbox polling** (Task 14), and **the sending-window pause** (Task 18) all rely on *something* pinging the app periodically to resume a paused campaign. A `send_later`/Routine-style recurring job (if this environment supports it), or accept that revisiting the app is what triggers them — these three could reasonably share a single "periodic maintenance" ping. Confirm which approach before building.
2. **The ramp schedule** (day 0→10/day, day 4→25, day 15→50, day 30→75, day 60→100) is a default heuristic from common cold-outreach warm-up guidance, not a guaranteed-safe curve from Google — confirm it feels right, or provide preferred numbers/breakpoints.
3. **Task 12's WHOIS dependency** adds a new package and outbound non-HTTPS network calls to third-party registrars — explicitly confirm you want this before it's built, since it's the one piece of this plan that reaches outside your own infrastructure.
4. **Mailboxes-per-domain guideline** (default 4, used by Task 11's domain count) is a rough rule of thumb, not a hard rule from any provider — adjust if you have a different number in mind.
5. **SPF/DKIM/DMARC live DNS check** was flagged as a strong follow-up candidate (more reliable than WHOIS domain age, since DNS TXT records are deterministic and unambiguous) but isn't in this plan's tasks yet — worth adding as a future task once the core flow works, if you want it.
6. **Task 16 (open/click tracking)** — confirm you still want pixel-based open tracking given its acknowledged unreliability, or whether click tracking alone is enough.
7. **`APP_BASE_URL`** (Tasks 16 and 17) needs to be a real, publicly reachable URL for tracking links, unsubscribe links, and the `List-Unsubscribe` header to work at all — ties back to the earlier hosting/tunnel decision.
8. **Default sending window** (Task 18 defaults to 9am–5pm UTC, weekdays only) — confirm your preferred hours/timezone, since UTC is unlikely to match your actual audience.
9. **Task 19's design guidance came from the UI/UX skill's written reference only** — the actual searchable design-system database (color palettes, font pairings, generated component recommendations) isn't installed in this environment, so the durations/easing/contrast numbers used are real sourced values, but a generated palette/typography system wasn't available to pull from. If you want that fuller design-system generation, it'd need that tool available in whatever environment actually executes this.
