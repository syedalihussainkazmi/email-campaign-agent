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
