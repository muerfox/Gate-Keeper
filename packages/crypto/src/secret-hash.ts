import { createHash, timingSafeEqual } from "node:crypto";

/** Unsalted SHA-256 digest for storing HIGH-ENTROPY secrets (API keys,
 * session tokens) at rest. This is deliberately NOT for passwords — see
 * password.ts (scrypt) for that. A per-record salt exists to defeat
 * precomputed dictionaries against low-entropy human-chosen secrets; a
 * randomly generated 256-bit API key has no dictionary to precompute
 * against, so a plain fast hash (checked in constant time) is the
 * appropriate, standard choice here (the same pattern used by most API
 * platforms for key storage). */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function verifySecretHash(candidate: string, expectedHash: string): boolean {
  const a = Buffer.from(hashSecret(candidate));
  const b = Buffer.from(expectedHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
