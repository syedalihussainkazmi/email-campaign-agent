const HTML_TAG_REGEX = /<[a-z][\s\S]*>/i;

/** True if a string looks like it contains markup rather than being plain prose. */
export function looksLikeHtml(value: string): boolean {
  return HTML_TAG_REGEX.test(value);
}

/** Strips tags for a reasonable plain-text fallback when the source is HTML. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
