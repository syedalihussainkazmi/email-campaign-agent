const SPAM_TRIGGER_WORDS = [
  "free",
  "act now",
  "buy now",
  "click here",
  "limited time",
  "guarantee",
  "winner",
  "cash",
  "urgent",
  "risk-free",
];

export interface SpamScoreResult {
  score: number; // 0 (clean) – 100 (very spammy)
  hints: string[];
}

/** Lightweight heuristic spam-score hint — not a substitute for a real filter, just a nudge. */
export function scoreSpamRisk(subject: string, bodyText: string): SpamScoreResult {
  const combined = `${subject} ${bodyText}`.toLowerCase();
  const hints: string[] = [];
  let score = 0;

  for (const word of SPAM_TRIGGER_WORDS) {
    if (combined.includes(word)) {
      score += 8;
      hints.push(`Contains trigger phrase "${word}"`);
    }
  }

  const exclamations = (combined.match(/!/g) ?? []).length;
  if (exclamations > 3) {
    score += 10;
    hints.push("Excessive exclamation marks");
  }

  const upperRatio = subject.replace(/[^A-Za-z]/g, "").length
    ? subject.replace(/[^A-Z]/g, "").length / subject.replace(/[^A-Za-z]/g, "").length
    : 0;
  if (upperRatio > 0.5 && subject.length > 5) {
    score += 15;
    hints.push("Subject is mostly uppercase");
  }

  return { score: Math.min(100, score), hints };
}
