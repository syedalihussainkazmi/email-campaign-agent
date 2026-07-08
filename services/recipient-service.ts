const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export interface ParsedRecipients {
  valid: string[];
  invalid: string[];
  duplicates: string[];
}

/**
 * Extracts every email-looking token from free-form pasted text, normalizes
 * case, and buckets results into valid / invalid / duplicate. "Invalid"
 * covers malformed tokens that survive a loose scan (e.g. missing TLD);
 * duplicates are exact matches after normalization.
 */
export function parseRecipients(rawText: string): ParsedRecipients {
  const tokens = rawText
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];

  for (const token of tokens) {
    const match = token.match(EMAIL_REGEX);
    const normalized = match?.[0]?.toLowerCase();

    if (!normalized || !isValidEmail(normalized)) {
      invalid.push(token);
      continue;
    }

    if (seen.has(normalized)) {
      duplicates.push(normalized);
      continue;
    }

    seen.add(normalized);
    valid.push(normalized);
  }

  return { valid, invalid, duplicates };
}

export function isValidEmail(email: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

export function dedupeEmails(emails: string[]): string[] {
  return Array.from(new Set(emails.map((e) => e.toLowerCase())));
}
