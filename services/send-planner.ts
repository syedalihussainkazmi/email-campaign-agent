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
