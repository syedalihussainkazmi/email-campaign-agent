const PLACEHOLDER_REGEX = /\{([^{}]+)\}|\[([^[\]]+)\]/g;

/** Placeholder keys that all resolve to the recipient's business/contact name. */
const BUSINESS_ALIASES = new Set(["name", "businessname", "business"]);

/** Placeholder keys that all resolve to the owner/contact's personal name. */
const OWNER_ALIASES = new Set([
  "ownername",
  "owner",
  "ownersname",
  "contactname",
  "firstname",
  "fname",
  "first",
]);

/** Used when an owner-name placeholder has no explicit default and no owner name is known. */
const DEFAULT_OWNER_FALLBACK = "there";

export interface TemplateVariables {
  businessName: string;
  ownerName: string;
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Replaces {name} / {business name} / {owner name} / {First Name} /
 * [Business Name] (curly braces or square brackets, any casing/spacing)
 * with the recipient's business or owner/contact name. A placeholder may
 * specify its own fallback with a pipe — {owner name|there} uses "there"
 * whenever that recipient has no owner name — and {owner name} on its own
 * already falls back to "there" automatically, so a cold-outreach greeting
 * never goes out blank. Unrecognized placeholders are left untouched
 * rather than silently dropped, so a typo is visible in the sent email
 * instead of vanishing.
 */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(PLACEHOLDER_REGEX, (match, curlyKey: string, bracketKey: string) => {
    const rawKey = curlyKey ?? bracketKey;
    const [keyPart, ...defaultParts] = rawKey.split("|");
    const explicitDefault = defaultParts.length > 0 ? defaultParts.join("|").trim() : undefined;
    const key = normalizeKey(keyPart);

    if (BUSINESS_ALIASES.has(key)) {
      if (variables.businessName) return variables.businessName;
      return explicitDefault ?? match;
    }

    if (OWNER_ALIASES.has(key)) {
      if (variables.ownerName) return variables.ownerName;
      return explicitDefault ?? DEFAULT_OWNER_FALLBACK;
    }

    return match;
  });
}
