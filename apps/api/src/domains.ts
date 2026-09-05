/** Extracts a hostname from an Origin or Referer header. Returns null for
 * anything that doesn't parse as a URL (never throws on attacker input). */
export function extractHostname(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  try {
    return new URL(headerValue).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Enforces the "a token issued for one configured site must not
 * automatically work on another site" requirement at the domain level: a
 * public site key may only be used from an Origin/Referer that the site
 * administrator has explicitly registered (docs/THREAT_MODEL.md §4.3).
 * Exact hostname match only — no wildcard/subdomain inference, since that
 * would silently broaden the trust boundary the administrator configured.
 *
 * Pure/sync and takes the hostname list directly (rather than querying the
 * database itself) so callers can pass a cached list — see site-meta.ts —
 * instead of a DB round trip on every request.
 */
export function isDomainAllowed(registeredHostnames: string[], hostname: string | null): boolean {
  if (!hostname) return false;
  return registeredHostnames.includes(hostname);
}
