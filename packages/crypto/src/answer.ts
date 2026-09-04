import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Salted digest of a challenge's expected answer, stored server-side
 * (Redis/DB) and NEVER sent to the client. Salting per-challenge prevents
 * precomputed-hash attacks against a stolen digest table, and the digest
 * form means the answer isn't sitting in plaintext in Redis/DB either. */
export function hashAnswer(answer: string, salt = randomBytes(16).toString("base64url")): { hash: string; salt: string } {
  const hash = createHash("sha256").update(salt).update(answer.normalize("NFKC")).digest("base64url");
  return { hash, salt };
}

export function verifyAnswer(candidate: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashAnswer(candidate, salt);
  const a = Buffer.from(hash);
  const b = Buffer.from(expectedHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
