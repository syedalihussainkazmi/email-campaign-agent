# Simple Campaign Runner + Page Restructure Implementation Plan

**Goal:** Remove the automatic multi-account distribution/allocation logic from campaign creation, replace it with a manual single-account + manual daily-cap flow, split the app into six distinct pages (Dashboard, Campaign, Webmails, Calculator, History, Settings) instead of one crowded Settings page and one crowded composer, make Pause/Resume/Cancel/Delete work identically everywhere a campaign appears (Dashboard, History list, History detail), and give the whole app a modern, animated visual pass.

**Architecture:** The deliverability "brain" (ramp-schedule math: `capForAge`/`ageInDays`/`projectAccountCapacityTimeline`) stays as pure, reusable logic — what changes is *where* it's used. Today `buildSendPlan`/`buildUncappedAllocations` auto-pick accounts and auto-split recipients across them at campaign-creation time; that auto-distribution is deleted outright. In its place, the user manually picks one `SmtpAccount` and types a daily-send-cap number themselves — the same ramp-schedule math still runs, but only to *show a suggestion* next to the input, never to decide anything automatically. The existing per-recipient day-scheduling in `createCampaign` (round-robin across an `accountAllocations` queue, spilling extra recipients to future days) needs no changes at all: passing it a single-account allocation of `[{ accountId, count: dailyCap }]` already produces exactly the desired one-account, N-per-day, multi-day-if-needed schedule, because the existing overflow math (`accountQueue[i % accountQueue.length]`) naturally keeps re-picking that same one account on subsequent days.

A new shared `CampaignActionsBar` client component (Pause/Resume/Cancel/Delete, calling the same server actions everywhere) gets dropped into Dashboard, History list, and History detail so every one of those buttons behaves identically no matter which page it's on.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/Postgres, Zustand, framer-motion, Vitest, ESLint. No new dependencies.

---

## File Structure

| File | Role |
|---|---|
| `prisma/schema.prisma` | Add `Campaign.smtpAccountId` (String?) and `Campaign.dailyCap` (Int?) — bookkeeping only, for display; scheduling itself doesn't need them. |
| `services/send-planner.ts` | Remove `buildSendPlan`, `buildUncappedAllocations`, `SendPlan` interface. Keep everything else (`capForAge`, `ageInDays`, `DEFAULT_RAMP_SCHEDULE`, `PlannerAccount`, `toPlannerAccount`, `projectAccountCapacityTimeline`, `estimateSendSeconds`, `formatDuration`). |
| `services/campaign-service.ts` | Add `deleteCampaign(userId, campaignId)`. |
| `actions/campaign-actions.ts` | Rewrite `createAndStartCampaignAction` (single `accountId` + manual `dailyCap`, no auto-allocation). Remove `getSendPlanAction`. Add `getSuggestedDailyCapAction` and `deleteCampaignAction`. |
| `utils/motion.ts` | Add `staggerContainer`/`staggerItem` variants for list entrance animation. |
| `components/campaign/campaign-actions-bar.tsx` | **New.** Shared Pause/Resume/Cancel/Delete control, used on Dashboard, History list, History detail. |
| `components/campaign/campaign-list.tsx` | **New.** Client component wrapping a list of campaign cards in `staggerContainer`/`staggerItem` motion — needed because `app/dashboard/page.tsx` and `app/history/page.tsx` are server components and can't use framer-motion directly. Used by both. |
| `components/campaign/account-picker.tsx` | **New.** Single-account dropdown + age + suggested-cap hint, replaces `SendPlanPanel`'s role. |
| `components/campaign/campaign-runner-form.tsx` | **New**, replaces `components/campaign/campaign-card.tsx`. The simplified composer: subject/body, recipients, `AccountPicker`, manual daily-cap input, pacing toggle, ETA, Send button. |
| `components/campaign/send-plan-panel.tsx` | **Deleted** — superseded by `AccountPicker`. |
| `components/campaign/campaign-card.tsx` | **Deleted** — superseded by `CampaignRunnerForm`. |
| `app/campaign/page.tsx` | **New** route hosting `CampaignRunnerForm`. |
| `app/webmails/page.tsx` | **New** route: `SmtpAccountForm` + `SmtpAccountList` (moved out of Settings). |
| `app/calculator/page.tsx` | **New** route: `RolloutPlannerPanel` + `CapacityTimelinePanel` (moved out of Settings). |
| `app/dashboard/page.tsx` | **New** route: stat tiles + recent/active campaigns list with `CampaignActionsBar`. Becomes the new post-login landing page. |
| `app/settings/page.tsx` | Trimmed to just `SignatureForm` + `SendingWindowForm`. |
| `app/page.tsx` | Logged-in visitors now redirect to `/dashboard` instead of rendering the composer directly. |
| `app/history/page.tsx` | Add `CampaignActionsBar` per list item + stagger-in animation. |
| `app/history/[id]/page.tsx` | Add `CampaignActionsBar` + entrance animation. |
| `components/layout/top-nav.tsx` | New nav: Dashboard / Campaign / Webmails / Calculator / History / Settings / Logout, with motion. |
| `tests/send-planner.test.ts` | Remove tests for the deleted `buildSendPlan`/`buildUncappedAllocations` functions. |

---

### Task 1: Schema — add bookkeeping fields to Campaign

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the fields**

In the `Campaign` model, add two nullable fields right after `fixedDelaySeconds`:

```prisma
model Campaign {
  // ...existing fields...
  fixedDelaySeconds  Int?
  // Which single account this campaign runs from, and the daily cap the
  // user manually chose for it — bookkeeping for display only (History,
  // Dashboard). The actual send schedule is already fully encoded per-
  // recipient via CampaignRecipient.smtpAccountId/scheduledFor at creation
  // time; these two fields are never read by the runner itself.
  smtpAccountId      String?
  dailyCap           Int?

  user       User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  recipients CampaignRecipient[]

  @@index([userId, createdAt])
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `cd /home/user/email-campaign-agent && npx prisma migrate dev --name add_campaign_account_and_cap`

Expected: migration applies cleanly (both new columns are nullable — safe on a non-empty table, no backfill needed).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add Campaign.smtpAccountId/dailyCap bookkeeping fields"
```

---

### Task 2: `deleteCampaign` service function

**Files:**
- Modify: `services/campaign-service.ts`

- [ ] **Step 1: Add the function**

Add after `setCampaignControlFlag`:

```typescript
export async function deleteCampaign(userId: string, campaignId: string) {
  // CampaignRecipient rows cascade-delete automatically (onDelete: Cascade
  // in schema.prisma) — no need to delete them separately first.
  return prisma.campaign.deleteMany({ where: { id: campaignId, userId } });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add services/campaign-service.ts
git commit -m "Add deleteCampaign service function"
```

---

### Task 3: Remove auto-distribution from `send-planner.ts`

**Files:**
- Modify: `services/send-planner.ts`
- Modify: `tests/send-planner.test.ts`

- [ ] **Step 1: Delete `buildSendPlan`, `buildUncappedAllocations`, and the `SendPlan` interface**

Remove these three blocks from `services/send-planner.ts` (everything between `export interface SendPlan {` and the end of `buildUncappedAllocations`'s closing brace, i.e. lines defining `SendPlan`, `buildSendPlan`, and `buildUncappedAllocations`). Also remove the now-unused `dailyCapFor`/`remainingToday` helpers **only if nothing else references them** — check first:

Run: `cd /home/user/email-campaign-agent && grep -rn "dailyCapFor\|remainingToday\|buildSendPlan\|buildUncappedAllocations\|SendPlan\b" --include="*.ts" --include="*.tsx" .`

Expected output after this task's edit: no matches anywhere outside `send-planner.ts` itself, and none at all once the edit is done (both helpers are only used by the two functions being deleted).

The resulting file should read, in full:

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
 * Estimates wall-clock time to send today's batch, given the runner's
 * one-recipient-at-a-time pacing (server/campaign-runner.ts): a flat 5s gap
 * when fixed pace is on, or the midpoint of the randomized 5-10s gap
 * otherwise. Pure arithmetic — not a promise about real-world SMTP latency.
 */
export function estimateSendSeconds(todaysBatchSize: number, useFixedPace: boolean): number {
  const avgDelaySeconds = useFixedPace ? 5 : 7.5;
  return Math.round(Math.max(0, todaysBatchSize - 1) * avgDelaySeconds);
}

/** Formats a second count as a compact human string: "45s", "12m", "1h 30m". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

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

- [ ] **Step 2: Remove the now-obsolete tests**

Open `tests/send-planner.test.ts` and delete the `describe("buildSendPlan", ...)` block in full, and delete the `describe("buildUncappedAllocations", ...)` block in full. Also remove `buildSendPlan` and `buildUncappedAllocations` from the top `import` line, leaving:

```typescript
import {
  capForAge,
  ageInDays,
  projectAccountCapacityTimeline,
  estimateSendSeconds,
  formatDuration,
} from "@/services/send-planner";
```

Also delete the now-unused `account()` helper function at the top of the file **only if** nothing else in the file still calls it after the above deletions — check with:

Run: `cd /home/user/email-campaign-agent && grep -n "account(" tests/send-planner.test.ts`

If no calls remain outside the helper's own definition, delete the helper too.

- [ ] **Step 3: Run the remaining tests**

Run: `cd /home/user/email-campaign-agent && npx vitest run tests/send-planner.test.ts`
Expected: PASS — remaining tests for `capForAge`, `ageInDays`, `projectAccountCapacityTimeline`, `estimateSendSeconds`, `formatDuration` all still pass.

- [ ] **Step 4: Commit**

```bash
git add services/send-planner.ts tests/send-planner.test.ts
git commit -m "Remove auto-distribution (buildSendPlan/buildUncappedAllocations) from send-planner"
```

---

### Task 4: Rewrite `campaign-actions.ts` for manual single-account sending

**Files:**
- Modify: `actions/campaign-actions.ts`

- [ ] **Step 1: Replace `createAndStartCampaignAction` and its schema**

Replace the whole file with:


```typescript
"use server";

import { z } from "zod";
import { requireSession } from "@/auth/session";
import { createCampaign, setCampaignControlFlag, deleteCampaign } from "@/services/campaign-service";
import { logAudit } from "@/services/audit-service";
import { startCampaignRunner } from "@/server/campaign-runner";
import { isRateLimited } from "@/server/rate-limiter";
import { listSmtpAccounts } from "@/services/smtp-service";
import { capForAge, toPlannerAccount, projectAccountCapacityTimeline } from "@/services/send-planner";
import { planNewRollout } from "@/services/rollout-planner";
import { prisma } from "@/database/prisma";

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
  accountId: z.string().min(1, "Select an email account to send from"),
  dailyCap: z.number().int().min(1, "Enter how many to send per day"),
  useFixedPace: z.boolean().default(false),
});

export async function createAndStartCampaignAction(input: z.infer<typeof createCampaignSchema>) {
  const session = await requireSession();
  if (isRateLimited(`create-campaign:${session.user.id}`)) {
    throw new Error("Too many campaigns started, please slow down");
  }

  const parsed = createCampaignSchema.parse(input);

  // Re-verify the chosen account actually belongs to this user — never trust
  // the client-supplied accountId on its own.
  const allAccounts = await listSmtpAccounts(session.user.id);
  const account = allAccounts.find((a) => a.id === parsed.accountId);
  if (!account) {
    throw new Error("Selected email account not found");
  }

  const { campaign, skippedUnsubscribed } = await createCampaign({
    userId: session.user.id,
    subject: parsed.subject,
    bodyHtml: parsed.bodyHtml,
    bodyText: parsed.bodyText,
    recipients: parsed.recipients,
    accountAllocations: [{ accountId: parsed.accountId, count: parsed.dailyCap }],
    fixedDelaySeconds: parsed.useFixedPace ? 5 : undefined,
  });

  // Bookkeeping only — the schedule itself was already fully decided above.
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { smtpAccountId: parsed.accountId, dailyCap: parsed.dailyCap },
  });

  await logAudit(session.user.id, "campaign.create", { type: "campaign", id: campaign.id });

  void startCampaignRunner(campaign.id);

  return { campaignId: campaign.id, skippedUnsubscribed };
}

export async function listAccountsForPlanningAction() {
  const session = await requireSession();
  return listSmtpAccounts(session.user.id);
}

const suggestedCapSchema = z.object({ accountId: z.string().min(1) });

/** Pure informational suggestion — never applied automatically. */
export async function getSuggestedDailyCapAction(input: z.infer<typeof suggestedCapSchema>) {
  const session = await requireSession();
  const { accountId } = suggestedCapSchema.parse(input);
  const accounts = await listSmtpAccounts(session.user.id);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;
  const planner = toPlannerAccount(account);
  return {
    ageDays: planner.ageDays,
    suggestedDailyCap: planner.dailyCapOverride ?? capForAge(planner.ageDays),
  };
}

const rolloutPlanSchema = z.object({ totalRecipients: z.number().int().min(1) });

export async function planRolloutAction(input: z.infer<typeof rolloutPlanSchema>) {
  await requireSession();
  const { totalRecipients } = rolloutPlanSchema.parse(input);
  return planNewRollout(totalRecipients);
}

const capacityTimelineSchema = z.object({ recipientCount: z.number().int().min(1) });

export async function projectCapacityTimelineAction(input: z.infer<typeof capacityTimelineSchema>) {
  const session = await requireSession();
  const { recipientCount } = capacityTimelineSchema.parse(input);
  const accounts = (await listSmtpAccounts(session.user.id)).map(toPlannerAccount);
  return projectAccountCapacityTimeline(accounts, recipientCount);
}

const controlSchema = z.object({
  campaignId: z.string().min(1),
  flag: z.enum(["none", "pause", "cancel"]),
});

export async function setCampaignControlAction(input: z.infer<typeof controlSchema>) {
  const session = await requireSession();
  const parsed = controlSchema.parse(input);

  await setCampaignControlFlag(session.user.id, parsed.campaignId, parsed.flag);
  await logAudit(session.user.id, `campaign.${parsed.flag}`, { type: "campaign", id: parsed.campaignId });

  if (parsed.flag === "none") {
    void startCampaignRunner(parsed.campaignId);
  }

  return { ok: true };
}

const deleteSchema = z.object({ campaignId: z.string().min(1) });

export async function deleteCampaignAction(input: z.infer<typeof deleteSchema>) {
  const session = await requireSession();
  const { campaignId } = deleteSchema.parse(input);

  await deleteCampaign(session.user.id, campaignId);
  await logAudit(session.user.id, "campaign.delete", { type: "campaign", id: campaignId });

  return { ok: true };
}
```

This deletes the old `buildSendPlan`/`buildUncappedAllocations`/`getSendPlanAction` code path entirely and replaces `accountIds: string[]` with a single `accountId` plus a manually-typed `dailyCap`.

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add actions/campaign-actions.ts
git commit -m "Replace auto-distribution with manual single-account + daily-cap campaign creation"
```

---

### Task 5: Shared motion tokens for list entrance animation

**Files:**
- Modify: `utils/motion.ts`

- [ ] **Step 1: Add stagger variants**

Append to `utils/motion.ts`:

```typescript
/** Parent wrapper for a list of cards — staggers children in on mount. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

/** Individual list item entrance, used inside a staggerContainer. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: MOTION_DURATION.base, ease: EASE_OUT } },
};
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add utils/motion.ts
git commit -m "Add stagger motion variants for list entrance animation"
```

---

### Task 6: Shared `CampaignActionsBar` component

**Files:**
- Create: `components/campaign/campaign-actions-bar.tsx`

This is the single component that makes Pause/Resume/Cancel/Delete work identically on Dashboard, History list, and History detail — each of those pages renders this same component and nothing else for controls.

- [ ] **Step 1: Write the component**

```typescript
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setCampaignControlAction, deleteCampaignAction } from "@/actions/campaign-actions";
import type { CampaignStatus } from "@/types/campaign";

interface CampaignActionsBarProps {
  campaignId: string;
  status: CampaignStatus;
  /** Renders compact icon-less text buttons — used in dense list rows. */
  size?: "sm" | "default";
}

export function CampaignActionsBar({ campaignId, status, size = "sm" }: CampaignActionsBarProps) {
  const router = useRouter();
  const [pending, setPending] = useState<"pause" | "resume" | "cancel" | "delete" | null>(null);

  async function handleControl(flag: "none" | "pause" | "cancel", pendingLabel: typeof pending) {
    setPending(pendingLabel);
    try {
      await setCampaignControlAction({ campaignId, flag });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this campaign permanently? This can't be undone.")) return;
    setPending("delete");
    try {
      await deleteCampaignAction({ campaignId });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  const canPause = status === "running";
  const canResume = status === "paused";
  const canCancel = status === "running" || status === "paused";

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {canPause && (
        <Button
          size={size}
          variant="outline"
          disabled={pending !== null}
          onClick={() => handleControl("pause", "pause")}
        >
          {pending === "pause" ? "Pausing…" : "Pause"}
        </Button>
      )}
      {canResume && (
        <Button
          size={size}
          variant="outline"
          disabled={pending !== null}
          onClick={() => handleControl("none", "resume")}
        >
          {pending === "resume" ? "Resuming…" : "Resume"}
        </Button>
      )}
      {canCancel && (
        <Button
          size={size}
          variant="destructive"
          disabled={pending !== null}
          onClick={() => handleControl("cancel", "cancel")}
        >
          {pending === "cancel" ? "Cancelling…" : "Cancel"}
        </Button>
      )}
      <Button size={size} variant="ghost" disabled={pending !== null} onClick={handleDelete}>
        {pending === "delete" ? "Deleting…" : "Delete"}
      </Button>
    </div>
  );
}
```

The `onClick={(e) => e.stopPropagation()}` on the wrapping `div` matters: History list rows are wrapped in a `<Link>` (clicking the card navigates to the detail page) — without stopping propagation, clicking a button inside that row would both fire the button's own handler *and* navigate away.

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/campaign/campaign-actions-bar.tsx
git commit -m "Add shared CampaignActionsBar (Pause/Resume/Cancel/Delete)"
```

---

### Task 7: Shared animated `CampaignList` component

**Files:**
- Create: `components/campaign/campaign-list.tsx`

`app/dashboard/page.tsx` and `app/history/page.tsx` are both async server components (they call `auth()` and fetch data server-side) — framer-motion's `motion.div` only works inside a client component. Rather than duplicate the stagger-list markup twice, this one client component takes a plain array of campaign summaries and renders them, reused by both Dashboard (compact stats) and History (full stats).

- [ ] **Step 1: Write the component**

```typescript
"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CampaignActionsBar } from "@/components/campaign/campaign-actions-bar";
import { staggerContainer, staggerItem } from "@/utils/motion";
import type { CampaignStatus } from "@/types/campaign";

const STATUS_VARIANT = {
  draft: "default",
  running: "warning",
  paused: "warning",
  completed: "success",
  failed: "destructive",
} as const;

export interface CampaignListItem {
  id: string;
  subject: string;
  status: CampaignStatus;
  createdAt: Date;
  totalCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  bouncedCount: number;
  repliedCount: number;
}

interface CampaignListProps {
  campaigns: CampaignListItem[];
  /** "history" shows the full delivered/failed/bounced/replied row; "dashboard" shows just sent/total. */
  variant: "history" | "dashboard";
}

export function CampaignList({ campaigns, variant }: CampaignListProps) {
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="flex flex-col gap-3">
      {campaigns.map((c) => (
        <motion.div key={c.id} variants={staggerItem}>
          <Card className="transition-colors hover:border-zinc-700">
            <Link href={`/history/${c.id}`} className="block">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>{c.subject}</CardTitle>
                  <CardDescription>{c.createdAt.toLocaleString()}</CardDescription>
                </div>
                <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
              </CardHeader>
              <CardContent className="flex gap-6 text-xs text-zinc-400">
                {variant === "history" ? (
                  <>
                    <span>Total: {c.totalCount}</span>
                    <span>Delivered: {c.deliveredCount}</span>
                    <span>Failed: {c.failedCount}</span>
                    <span>Bounced: {c.bouncedCount}</span>
                    <span>Replied: {c.repliedCount}</span>
                  </>
                ) : (
                  <span>
                    {c.sentCount}/{c.totalCount} sent
                  </span>
                )}
              </CardContent>
            </Link>
            <CardContent className="pt-0">
              <CampaignActionsBar campaignId={c.id} status={c.status} />
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </motion.div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: no errors (the `CampaignActionsBar` import here is forward-referencing Task 6, already built by this point).

- [ ] **Step 3: Commit**

```bash
git add components/campaign/campaign-list.tsx
git commit -m "Add shared animated CampaignList (used by Dashboard and History)"
```

---

### Task 8: `AccountPicker` component

**Files:**
- Create: `components/campaign/account-picker.tsx`

Replaces `SendPlanPanel`'s role: instead of a multi-select checkbox list that auto-computes an allocation, this is a single dropdown plus a manual number input, with a non-binding suggestion shown alongside.

- [ ] **Step 1: Write the component**

```typescript
"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ageInDays } from "@/services/send-planner";
import type { SmtpAccountRecord } from "@/services/smtp-service";
import { listAccountsForPlanningAction, getSuggestedDailyCapAction } from "@/actions/campaign-actions";

interface AccountPickerProps {
  accountId: string;
  onAccountChange: (accountId: string) => void;
  dailyCap: string;
  onDailyCapChange: (value: string) => void;
}

export function AccountPicker({ accountId, onAccountChange, dailyCap, onDailyCapChange }: AccountPickerProps) {
  const [accounts, setAccounts] = useState<SmtpAccountRecord[]>([]);
  const [suggestion, setSuggestion] = useState<{ ageDays: number; suggestedDailyCap: number } | null>(null);

  useEffect(() => {
    listAccountsForPlanningAction().then((all) => {
      setAccounts(all);
      if (!accountId && all.length > 0) onAccountChange(all[0].id);
    });
    // Only run once on mount — onAccountChange/accountId intentionally excluded
    // to avoid re-fetching the account list on every selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!accountId) {
      setSuggestion(null);
      return;
    }
    getSuggestedDailyCapAction({ accountId }).then(setSuggestion);
  }, [accountId]);

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-amber-400">
        No email accounts connected yet — add one on the Webmails page before creating a campaign.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-4">
      <label className="text-sm font-medium text-zinc-100">Send from</label>
      <select
        value={accountId}
        onChange={(e) => onAccountChange(e.target.value)}
        className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.label} ({account.fromEmail}, {ageInDays(account.mailboxAgeStartDate)}d old)
          </option>
        ))}
      </select>

      <label className="mt-2 text-sm font-medium text-zinc-100">Send per day</label>
      <Input
        placeholder="e.g. 25"
        inputMode="numeric"
        value={dailyCap}
        onChange={(e) => onDailyCapChange(e.target.value)}
      />
      {suggestion && (
        <p className="text-xs text-zinc-500">
          Suggested for a {suggestion.ageDays}-day-old account: {suggestion.suggestedDailyCap}/day. This is
          only a suggestion — send whatever number you decide.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/campaign/account-picker.tsx
git commit -m "Add AccountPicker (single account + manual daily cap, with a non-binding suggestion)"
```

---

### Task 9: `CampaignRunnerForm` — the new simplified composer

**Files:**
- Create: `components/campaign/campaign-runner-form.tsx`
- Delete: `components/campaign/campaign-card.tsx`
- Delete: `components/campaign/send-plan-panel.tsx`

- [ ] **Step 1: Write the new composer**

```typescript
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
```

- [ ] **Step 2: Delete the two superseded files**

```bash
rm /home/user/email-campaign-agent/components/campaign/campaign-card.tsx
rm /home/user/email-campaign-agent/components/campaign/send-plan-panel.tsx
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: errors pointing at every file that still imports `CampaignCard` or `SendPlanPanel` (at minimum `app/page.tsx`) — that's expected and gets fixed in Task 14.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add CampaignRunnerForm, remove CampaignCard and SendPlanPanel"
```

(This commit will leave the build broken until Task 13 updates `app/page.tsx` — that's fine, later tasks fix it. Commit anyway to keep history granular; if you'd rather keep `main`/the working branch always green, fold this task's commit together with Task 14's instead.)

---

### Task 10: `/campaign` page

**Files:**
- Create: `app/campaign/page.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { CampaignRunnerForm } from "@/components/campaign/campaign-runner-form";

export default async function CampaignPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <AuthedShell>
      <CampaignRunnerForm />
    </AuthedShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: this file itself is clean (pre-existing errors from Task 9 elsewhere are still expected at this point).

- [ ] **Step 3: Commit**

```bash
git add app/campaign/page.tsx
git commit -m "Add /campaign page hosting the campaign runner"
```

---

### Task 11: `/webmails` page

**Files:**
- Create: `app/webmails/page.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SmtpAccountList } from "@/components/campaign/smtp-account-list";
import { listSmtpAccounts } from "@/services/smtp-service";

export default async function WebmailsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const accounts = await listSmtpAccounts(session.user.id);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Webmails</h1>
      <Card>
        <CardHeader>
          <CardTitle>Email Accounts</CardTitle>
          <CardDescription>Connect as many webmail accounts as you want to send from.</CardDescription>
        </CardHeader>
        <CardContent>
          <SmtpAccountList accounts={accounts} />
        </CardContent>
      </Card>
    </AuthedShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/webmails/page.tsx
git commit -m "Add /webmails page"
```

---

### Task 12: `/calculator` page

**Files:**
- Create: `app/calculator/page.tsx`

- [ ] **Step 1: Write the page**

```typescript
import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RolloutPlannerPanel } from "@/components/campaign/rollout-planner-panel";
import { CapacityTimelinePanel } from "@/components/campaign/capacity-timeline-panel";

export default async function CalculatorPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Calculator</h1>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Volume Calculator</CardTitle>
            <CardDescription>
              Plan a rollout from scratch, independent of what&apos;s currently connected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RolloutPlannerPanel />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Capacity Timeline</CardTitle>
            <CardDescription>
              Using the accounts you actually have connected right now, and their real ages.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CapacityTimelinePanel />
          </CardContent>
        </Card>
      </div>
    </AuthedShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/calculator/page.tsx
git commit -m "Add /calculator page"
```

---

### Task 13: `/dashboard` page

**Files:**
- Create: `app/dashboard/page.tsx`

This becomes the new post-login landing page: stat tiles plus every non-finished campaign (running/paused/draft) with working controls right there, no click-through needed.

- [ ] **Step 1: Write the page**

```typescript
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CampaignList } from "@/components/campaign/campaign-list";
import { listCampaigns } from "@/services/campaign-service";
import { prisma } from "@/database/prisma";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const [{ items: allCampaigns, total }, aggregate] = await Promise.all([
    listCampaigns(session.user.id, 1, 100),
    prisma.campaign.aggregate({
      where: { userId: session.user.id },
      _sum: { sentCount: true, deliveredCount: true, failedCount: true },
    }),
  ]);

  const active = allCampaigns.filter((c) => c.status === "running" || c.status === "paused");

  const tiles = [
    { label: "Total Campaigns", value: total },
    { label: "Emails Sent", value: aggregate._sum.sentCount ?? 0 },
    { label: "Delivered", value: aggregate._sum.deliveredCount ?? 0 },
    { label: "Failed", value: aggregate._sum.failedCount ?? 0 },
  ];

  return (
    <AuthedShell>
      <div className="flex items-center justify-between">
        <h1 className="mb-6 text-lg font-semibold text-zinc-100">Dashboard</h1>
        <Link href="/campaign">
          <Button size="sm">New Campaign</Button>
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardHeader>
              <CardTitle className="text-xs font-normal text-zinc-500">{tile.label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold text-zinc-100">{tile.value}</CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 text-sm font-semibold text-zinc-300">Active Campaigns</h2>
      {active.length === 0 ? (
        <p className="text-sm text-zinc-500">No running or paused campaigns.</p>
      ) : (
        <CampaignList campaigns={active} variant="dashboard" />
      )}
    </AuthedShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: no errors from this file (check that `prisma.campaign.aggregate`'s return shape matches — `_sum.sentCount` etc. are typed `number | null`, hence the `?? 0` fallbacks above; and that `Campaign` rows returned by `listCampaigns` structurally satisfy `CampaignListItem` from Task 7 — they do, since `listCampaigns` returns full Prisma `Campaign` rows which are a superset of that interface's fields).

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "Add /dashboard page with stat tiles and working campaign controls"
```

---

### Task 14: Trim `/settings`, redirect `/` when logged in

**Files:**
- Modify: `app/settings/page.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Trim Settings down to Signature + Sending Window only**

Replace `app/settings/page.tsx` in full:

```typescript
import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SignatureForm } from "@/components/campaign/signature-form";
import { SendingWindowForm } from "@/components/campaign/sending-window-form";
import { getSignature } from "@/services/signature-service";
import { getSendingWindow } from "@/services/sending-window-service";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const [signature, sendingWindow] = await Promise.all([
    getSignature(session.user.id),
    getSendingWindow(session.user.id),
  ]);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Settings</h1>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Sending Window</CardTitle>
            <CardDescription>Restrict campaigns to business hours for your audience&apos;s timezone.</CardDescription>
          </CardHeader>
          <CardContent>
            <SendingWindowForm initialValue={sendingWindow} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email Signature</CardTitle>
            <CardDescription>Appended automatically to the end of every campaign you send.</CardDescription>
          </CardHeader>
          <CardContent>
            <SignatureForm initialValue={signature} />
          </CardContent>
        </Card>
      </div>
    </AuthedShell>
  );
}
```

- [ ] **Step 2: Redirect logged-in visitors from `/` to `/dashboard`**

Replace `app/page.tsx` in full:

```typescript
import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { WebmailSignInForm } from "@/components/auth/webmail-signin-form";
import { LogoMark } from "@/components/brand/logo";

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 text-center">
      <div className="flex flex-col items-center gap-3">
        <LogoMark className="h-12 w-12" />
        <h1 className="text-2xl font-extrabold tracking-tight">
          <span className="text-zinc-100">Mail</span>
          <span className="text-red-500">Pilot</span>
        </h1>
        <p className="text-sm text-zinc-400">AI-assisted email campaigns, sent from your own webmail.</p>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">
          by DevXtech <span className="text-red-500">&middot;</span> devxtech.com
        </p>
      </div>

      <WebmailSignInForm />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: no errors anywhere now (this was the fix for the errors Task 9 intentionally left behind).

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx app/page.tsx
git commit -m "Trim Settings to signature/sending-window, redirect logged-in root to /dashboard"
```

---

### Task 15: Wire `CampaignActionsBar`/`CampaignList` into History (list + detail)

**Files:**
- Modify: `app/history/page.tsx`
- Modify: `app/history/[id]/page.tsx`

- [ ] **Step 1: Rewrite the History list page to use `CampaignList`**

Replace `app/history/page.tsx` in full:

```typescript
import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { listCampaigns } from "@/services/campaign-service";
import { CampaignList } from "@/components/campaign/campaign-list";

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const { items } = await listCampaigns(session.user.id);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Campaign History</h1>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No campaigns yet.</p>
      ) : (
        <CampaignList campaigns={items} variant="history" />
      )}
    </AuthedShell>
  );
}
```

`CampaignList` (Task 7) already wraps its `Link` around only the header/stats and puts `CampaignActionsBar` in its own `CardContent` outside that `Link` — so its buttons are never nested inside an `<a>` tag (nesting interactive elements inside a link is both invalid HTML and the source of click-conflicts), and combined with the `stopPropagation()` already inside `CampaignActionsBar` from Task 6, clicking any control button never triggers navigation to the detail page.

- [ ] **Step 2: Add the bar to the detail page**

In `app/history/[id]/page.tsx`, add the import and render the bar next to the status badge. Modify the `CardHeader` block:

```typescript
import { CampaignActionsBar } from "@/components/campaign/campaign-actions-bar";
```

Then change:

```typescript
            <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge>
```

to:

```typescript
            <div className="flex items-center gap-3">
              <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge>
              <CampaignActionsBar campaignId={campaign.id} status={campaign.status} />
            </div>
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/history/page.tsx "app/history/[id]/page.tsx"
git commit -m "Wire CampaignActionsBar into History list and detail pages"
```

---

### Task 16: New top nav

**Files:**
- Modify: `components/layout/top-nav.tsx`

- [ ] **Step 1: Rewrite the nav with all six pages**

```typescript
import Link from "next/link";
import { auth, signOut } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/campaign", label: "Campaign" },
  { href: "/webmails", label: "Webmails" },
  { href: "/calculator", label: "Calculator" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export async function TopNav() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/80 px-6 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-6">
        <Logo />
        {session?.user?.email && <span className="text-xs text-zinc-500">{session.user.email}</span>}
      </div>

      <nav className="flex flex-wrap items-center gap-1">
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            <Button
              variant="ghost"
              size="sm"
              className="transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              {link.label}
            </Button>
          </Link>
        ))}
        {session?.user && (
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <Button variant="ghost" size="sm" type="submit">
              Logout
            </Button>
          </form>
        )}
      </nav>
    </header>
  );
}
```

(`Button`'s base class already includes `transition-[color,background-color,transform]` from the earlier motion pass — the `hover:bg-zinc-800` here rides that same transition, so nav links get a smooth hover instead of a hard snap.)

- [ ] **Step 2: Typecheck**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add components/layout/top-nav.tsx
git commit -m "Add all six pages to the top nav"
```

---

### Task 17: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full check suite**

Run: `cd /home/user/email-campaign-agent && npx tsc --noEmit && npx vitest run && npx eslint .`
Expected: all clean.

- [ ] **Step 2: Live walkthrough**

Start the app against a local Postgres (same pattern used throughout this project: temporary `.env` with `DATABASE_URL`/`ENCRYPTION_KEY`, `npm run dev`, a scripted Playwright session with a real test session cookie) and confirm, with screenshots:

1. Logging in redirects to `/dashboard`, not the old composer.
2. Dashboard shows stat tiles and any active campaigns with working Pause/Resume/Cancel/Delete.
3. `/campaign` shows the new simplified composer — single account dropdown, manual daily-cap input with a suggestion hint, no multi-account checkboxes anywhere.
4. `/webmails` shows the account list/form (moved out of Settings).
5. `/calculator` shows both calculator panels (moved out of Settings).
6. `/settings` shows only Signature and Sending Window.
7. Creating a campaign against one account with a manual daily cap correctly schedules recipients (spot-check via a direct DB query, same pattern as prior verifications this session: recipients within the cap get `scheduledFor` = today against the chosen account; overflow recipients get spread to future days against the same account).
8. From History's list view, clicking Pause on a running campaign actually pauses it (status updates, verified via a fresh page load) — and Resume actually resumes it — without navigating away from the list.
9. From History's detail view, the same Pause/Resume/Cancel/Delete buttons work identically.
10. Delete asks for confirmation, then the campaign disappears from History after refresh.

- [ ] **Step 3: Clean up test data and commit any final fixes found during the walkthrough, then push**

```bash
git push -u origin claude/agent-creation-97aqu9
```
