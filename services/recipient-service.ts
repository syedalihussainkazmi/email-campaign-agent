const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const NAME_TRIM_CHARS = /^[\s,;:|<>\-–—"']+|[\s,;:|<>\-–—"']+$/g;

export interface ParsedRecipient {
  email: string;
  name: string;
}

export interface ParsedRecipients {
  valid: ParsedRecipient[];
  invalid: string[];
  duplicates: string[];
}

/**
 * Parses pasted recipient text one line at a time. Each line may be a bare
 * email, or an email paired with a business/contact name in any common
 * format ("Acme Corp, john@acme.com", "john@acme.com - Acme Corp",
 * "Acme Corp <john@acme.com>"). Lines containing multiple emails are treated
 * as a flat list (no name, since attribution would be ambiguous). Results
 * are bucketed into valid / invalid / duplicate, normalizing email case.
 */
export function parseRecipients(rawText: string): ParsedRecipients {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const valid: ParsedRecipient[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];

  for (const line of lines) {
    const matches = line.match(EMAIL_REGEX);

    if (!matches) {
      invalid.push(line);
      continue;
    }

    if (matches.length > 1) {
      for (const raw of matches) {
        addRecipient(raw.toLowerCase(), "");
      }
      continue;
    }

    const email = matches[0].toLowerCase();
    if (!isValidEmail(email)) {
      invalid.push(line);
      continue;
    }

    const name = line.replace(matches[0], "").replace(NAME_TRIM_CHARS, "").trim();
    addRecipient(email, name);
  }

  function addRecipient(email: string, name: string) {
    if (!isValidEmail(email)) {
      invalid.push(email);
      return;
    }
    if (seen.has(email)) {
      duplicates.push(email);
      return;
    }
    seen.add(email);
    valid.push({ email, name });
  }

  return { valid, invalid, duplicates };
}

export function isValidEmail(email: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

export function dedupeRecipients(recipients: ParsedRecipient[]): ParsedRecipient[] {
  const seen = new Map<string, ParsedRecipient>();
  for (const r of recipients) {
    const email = r.email.toLowerCase();
    if (!seen.has(email)) {
      seen.set(email, { email, name: r.name });
    }
  }
  return Array.from(seen.values());
}
