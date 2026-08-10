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

## Open questions to resolve with the user before/while executing

1. **Multi-day auto-resume**: Task 9 Step 2 needs *something* to hit `/api/campaigns/resume-scheduled` once a day for a spread-out campaign to finish on its own. Options: a `send_later`/Routine-style daily ping (if this environment supports it), or just accept that revisiting the app each day is what resumes it. Confirm which before building it.
2. **The ramp schedule** (day 0→10/day, day 4→25, day 15→50, day 30→75, day 60→100) is a default heuristic from common cold-outreach warm-up guidance, not a guaranteed-safe curve from Google — confirm it feels right, or provide preferred numbers/breakpoints.
3. **Task 12's WHOIS dependency** adds a new package and outbound non-HTTPS network calls to third-party registrars — explicitly confirm you want this before it's built, since it's the one piece of this plan that reaches outside your own infrastructure.
4. **Mailboxes-per-domain guideline** (default 4, used by Task 11's domain count) is a rough rule of thumb, not a hard rule from any provider — adjust if you have a different number in mind.
3. **SPF/DKIM/DMARC confirmation flag** was mentioned as a brainstorm idea but isn't in this plan's tasks — worth a follow-up task once the core multi-account/planner flow is working, since it's a UI+copy addition rather than new architecture.
