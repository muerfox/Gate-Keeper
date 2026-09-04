import { createHash } from "node:crypto";
import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureHex } from "../secure-random.js";

/** Hashcash-style bounded proof-of-work: find a `nonce` such that
 * sha256(seed + ":" + nonce) has at least `bits` leading zero bits. This is
 * a well-understood, server-cheaply-verifiable construction (a single hash
 * on verify vs. an expected ~2^bits hashes to solve) — not an invented
 * primitive, just SHA-256 used as intended.
 *
 * Purpose: raise the marginal CPU cost of each solve attempt, which matters
 * most against high-volume automation rather than a single human. Bounded
 * and admin-configurable (docs/THREAT_MODEL.md §4.5, §4.11): difficulty is
 * capped so a legitimate low-power device (mobile, throttled CPU) is never
 * asked for more than roughly tens of milliseconds of work, and
 * administrators can disable computational challenges entirely. */
function countLeadingZeroBits(hexDigest: string): number {
  let count = 0;
  for (const ch of hexDigest) {
    const nibble = parseInt(ch, 16);
    if (nibble === 0) {
      count += 4;
      continue;
    }
    count += Math.clz32(nibble) - 28;
    break;
  }
  return count;
}

const MAX_BITS = 20; // ~1M average hashes worst case; kept well below anything
// that would meaningfully burden a legitimate mobile device at a few
// hundred thousand hashes/sec in JS.

export const proofOfWorkGenerator: ChallengeGenerator = {
  type: "proof_of_work",
  accessible: true,
  generate(difficulty): GeneratedChallenge {
    const bits = Math.min(8 + difficulty * 2, MAX_BITS);
    const seed = secureHex(16);

    return {
      type: "proof_of_work",
      payload: {
        instruction: "Your browser will complete a short bounded computation automatically.",
        seed,
        bits,
      },
      expectedAnswer: JSON.stringify({ seed, bits }),
      minPlausibleSolveMs: 30,
    };
  },
  verify(answer, expectedAnswer): boolean {
    if (typeof answer !== "object" || answer === null) return false;
    const { nonce } = answer as { nonce?: unknown };
    if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 64) return false;
    const { seed, bits } = JSON.parse(expectedAnswer) as { seed: string; bits: number };
    const digest = createHash("sha256").update(`${seed}:${nonce}`).digest("hex");
    return countLeadingZeroBits(digest) >= bits;
  },
};
