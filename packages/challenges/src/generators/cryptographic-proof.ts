import { createHash } from "node:crypto";
import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureHex } from "../secure-random.js";

/** Sequential iterated-hash challenge: the client must compute
 * sha256^n(seed) — n repeated SHA-256 applications — and submit the final
 * digest. Unlike the search-based proof_of_work generator, this work is
 * inherently sequential (each step needs the previous output), so it
 * cannot be sped up by throwing parallel workers/GPU lanes at it the way a
 * hashcash search can. It is a lightweight approximation of a lower bound
 * on wall-clock cost, not a formal verifiable-delay function — documented
 * honestly rather than oversold. The server pays the same n iterations to
 * verify, so `iterations` is capped to keep verification cheap. */
const MAX_ITERATIONS = 200_000; // low tens of milliseconds server-side

function iteratedSha256(seed: string, iterations: number): string {
  let digest = Buffer.from(seed, "hex");
  for (let i = 0; i < iterations; i++) {
    digest = createHash("sha256").update(digest).digest();
  }
  return digest.toString("hex");
}

export const cryptographicProofGenerator: ChallengeGenerator = {
  type: "cryptographic_proof",
  accessible: true,
  generate(difficulty): GeneratedChallenge {
    const iterations = Math.min(10_000 + difficulty * 20_000, MAX_ITERATIONS);
    const seed = secureHex(32);
    const expected = iteratedSha256(seed, iterations);

    return {
      type: "cryptographic_proof",
      payload: {
        instruction: "Your browser will complete a short bounded computation automatically.",
        seed,
        iterations,
      },
      expectedAnswer: JSON.stringify({ expected }),
      minPlausibleSolveMs: 20,
    };
  },
  verify(answer, expectedAnswer): boolean {
    if (typeof answer !== "object" || answer === null) return false;
    const { digest } = answer as { digest?: unknown };
    if (typeof digest !== "string") return false;
    const { expected } = JSON.parse(expectedAnswer) as { expected: string };
    return digest.toLowerCase() === expected.toLowerCase();
  },
};
