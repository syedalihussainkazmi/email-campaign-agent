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
