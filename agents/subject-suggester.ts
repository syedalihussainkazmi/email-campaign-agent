/**
 * Rule-based subject-line assistant. Kept dependency-free (no external LLM
 * call) so the dashboard stays fast; swap the body for a real model call
 * behind this same signature if/when an AI subject generator is wired up.
 */
export function suggestSubjectImprovements(subject: string): string[] {
  const suggestions: string[] = [];

  if (subject.length === 0) {
    suggestions.push("Add a subject line — empty subjects hurt deliverability.");
    return suggestions;
  }

  if (subject.length > 60) {
    suggestions.push("Keep it under ~60 characters so it isn't truncated on mobile.");
  }

  if (!/[a-z]/.test(subject)) {
    suggestions.push("Avoid all-caps subjects — they read as spammy.");
  }

  if (!/[?!.]$/.test(subject.trim())) {
    suggestions.push("Consider ending with punctuation for a stronger hook.");
  }

  return suggestions;
}
