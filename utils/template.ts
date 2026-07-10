const PLACEHOLDER_REGEX = /\{([^{}]+)\}|\[([^[\]]+)\]/g;

/** Placeholder keys that all resolve to the recipient's business/contact name. */
const NAME_ALIASES = new Set(["name", "businessname", "business"]);

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Replaces {name} / {business name} / [Business Name] (curly braces or
 * square brackets, any casing/spacing) in a template string with the
 * recipient's business name. Unrecognized placeholders are left untouched
 * rather than silently dropped, so a typo is visible in the sent email
 * instead of vanishing.
 */
export function renderTemplate(template: string, businessName: string): string {
  return template.replace(PLACEHOLDER_REGEX, (match, curlyKey: string, bracketKey: string) => {
    const rawKey = curlyKey ?? bracketKey;
    return NAME_ALIASES.has(normalizeKey(rawKey)) ? businessName : match;
  });
}
