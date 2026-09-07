import { randomBytes } from "node:crypto";

/** Base64url without padding — URL/JSON-safe, and what jose/JWT tooling
 * expects for raw byte fields. Never use Math.random for anything security
 * relevant (docs/THREAT_MODEL.md explicitly calls out predictable
 * randomness as a threat). */
function toBase64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Cryptographically random identifier. 128 bits by default: large enough
 * that guessing/enumeration is infeasible, small enough to keep tokens and
 * URLs compact. */
export function randomId(bytes = 16): string {
  return toBase64Url(randomBytes(bytes));
}

/** Cryptographically random nonce, generated independently from any ID.
 * Used as the single-use replay key (see packages/rate-limit). */
export function randomNonce(bytes = 16): string {
  return toBase64Url(randomBytes(bytes));
}
