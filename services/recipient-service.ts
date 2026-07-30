const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const NAME_TRIM_CHARS = /^[\s,;:|<>\-–—"']+|[\s,;:|<>\-–—"']+$/g;
// Requires whitespace on at least one side of the dash, so a genuine
// hyphenated business name ("Coca-Cola", no spaces at all) never gets
// split, but a loosely-typed separator ("DevXtech- Syed Kazmi") still does.
const NAME_SEGMENT_SPLIT = /\s+[-–—]\s*|\s*[-–—]\s+/;

// Words/symbols that mark a segment as a business name rather than a person.
const BUSINESS_INDICATOR = new RegExp(
  "\\b(inc|llc|ltd|corp(oration)?|co|company|group|solutions?|tech(nologies)?|" +
    "agency|services?|studio|software|systems?|enterprises?|partners?|consulting|" +
    "holdings?|industries|labs?|ventures?|media|digital|associates?)\\b|[&@]|\\d",
  "i",
);

/** True for a short Title-Case phrase with no business-y words — "Syed Kazmi", not "Acme Corp". */
function looksLikePersonName(segment: string): boolean {
  const words = segment.trim().split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  if (BUSINESS_INDICATOR.test(segment)) return false;
  return words.every((w) => /^[A-Z][a-zA-Z'-]*$/.test(w));
}

/**
 * Assigns two name segments to business/owner regardless of which order
 * they were typed in, by checking which one reads like a person's name.
 * Falls back to the documented "business first, owner second" convention
 * when it's ambiguous (both or neither look like a person), so behavior
 * stays deterministic in the unclear cases.
 */
function assignNameSegments(first: string, second: string): { name: string; ownerName: string } {
  const firstIsPerson = looksLikePersonName(first);
  const secondIsPerson = looksLikePersonName(second);

  if (firstIsPerson && !secondIsPerson) return { name: second, ownerName: first };
  if (secondIsPerson && !firstIsPerson) return { name: first, ownerName: second };
  return { name: first, ownerName: second };
}

export interface ParsedRecipient {
  email: string;
  name: string;
  ownerName: string;
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
 * a business with several addresses). An optional second name segment
 * separated by " - " is treated as the owner/contact's personal name —
 * "DevXtech - Syed Kazmi - sk@devxtech.com" and "Syed Kazmi - DevXtech -
 * sk@devxtech.com" both work, since whichever segment reads like a
 * person's name (a short Title-Case phrase with no business-y words) is
 * assigned as the owner regardless of which order it was typed in.
 * Whatever remains after stripping every email is applied to all of them.
 * Results are bucketed into valid / invalid / duplicate, normalizing
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

    const leftover = matches
      .reduce((remainder, match) => remainder.replace(match, ""), line)
      .replace(NAME_TRIM_CHARS, "")
      .trim();

    const segments = leftover.split(NAME_SEGMENT_SPLIT).map((s) => s.trim());
    const { name, ownerName } =
      segments.length > 1
        ? assignNameSegments(segments[0], segments[1])
        : { name: segments[0] ?? "", ownerName: "" };

    for (const raw of matches) {
      addRecipient(raw.toLowerCase(), name, ownerName);
    }
  }

  function addRecipient(email: string, name: string, ownerName: string) {
    if (!isValidEmail(email)) {
      invalid.push(email);
      return;
    }
    if (seen.has(email)) {
      duplicates.push(email);
      return;
    }
    seen.add(email);
    valid.push({ email, name, ownerName });
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
      seen.set(email, { email, name: r.name, ownerName: r.ownerName });
    }
  }
  return Array.from(seen.values());
}
