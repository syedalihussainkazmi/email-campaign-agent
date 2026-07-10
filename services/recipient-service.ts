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
 * email, or one or more emails paired with a shared business/contact name in
 * any common format ("Acme Corp, john@acme.com", "john@acme.com - Acme Corp",
 * "Acme Corp <john@acme.com>", "Acme Corp: john@acme.com, sales@acme.com" for
 * a business with several addresses). Whatever text remains on the line
 * after stripping every email is treated as the name and applied to all of
 * them. Results are bucketed into valid / invalid / duplicate, normalizing
 * email case.
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

    const name = matches
      .reduce((remainder, match) => remainder.replace(match, ""), line)
      .replace(NAME_TRIM_CHARS, "")
      .trim();

    for (const raw of matches) {
      addRecipient(raw.toLowerCase(), name);
    }
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
