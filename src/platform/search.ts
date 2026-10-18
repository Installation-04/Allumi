/**
 * A user's search text as the text to find in a LIKE / ILIKE pattern. Prisma's `contains` puts the text between `%` as is, so a
 * `%` or `_` typed by the person would be a wildcard (and `%` alone would match everything): they are escaped.
 */
export function likeText(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}
