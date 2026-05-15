/**
 * Convert a name into a URL-safe slug (lowercase, hyphenated, only [a-z0-9-]).
 * Empty result throws — call sites must handle the case where name has no slug-able chars.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`slugify: empty result for "${name}"`);
  return slug;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidSlug(s: string): boolean {
  return SLUG_PATTERN.test(s);
}
