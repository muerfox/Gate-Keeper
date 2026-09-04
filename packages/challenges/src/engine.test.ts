import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { generateChallenge, verifyChallengeAnswer, selectChallengeType, ACCESSIBLE_CHALLENGE_TYPES } from "./engine.js";
import type { ChallengeType } from "@gatekeeper/shared";

const ALL_TYPES: ChallengeType[] = [
  "visual_object_selection",
  "image_classification",
  "spatial_reasoning",
  "sequence_recognition",
  "dynamic_interaction",
  "drag_drop",
  "rotation",
  "pattern_recognition",
  "proof_of_work",
  "cryptographic_proof",
  "accessible_alternative",
];

describe.each(ALL_TYPES)("challenge type: %s", (type) => {
  it("never leaks the answer into the public payload", () => {
    const { payload } = generateChallenge(type, 2);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("expectedAnswer");
  });

  it("generates a challenge answerable by re-deriving the correct answer", () => {
    for (let difficulty = 1; difficulty <= 5; difficulty++) {
      const generated = generateChallenge(type, difficulty);
      let answer: unknown = generated.expectedAnswer;
      // Reconstruct a structured answer for types whose expectedAnswer is
      // JSON-encoded rather than a bare scalar.
      try {
        answer = JSON.parse(generated.expectedAnswer);
      } catch {
        // bare string answer (e.g. pattern_recognition / spatial_reasoning)
      }

      if (type === "proof_of_work") {
        // Answer requires solving, not just echoing — handled below.
        continue;
      }
      if (type === "cryptographic_proof") {
        continue;
      }
      if (type === "dynamic_interaction") {
        const { cueDelayMs } = answer as { cueDelayMs: number };
        expect(verifyChallengeAnswer(type, { heldMs: cueDelayMs }, generated.expectedAnswer, difficulty)).toBe(true);
        continue;
      }
      if (type === "rotation") {
        const { targetRotationDeg } = answer as { targetRotationDeg: number };
        expect(verifyChallengeAnswer(type, targetRotationDeg, generated.expectedAnswer, difficulty)).toBe(true);
        continue;
      }
      expect(verifyChallengeAnswer(type, answer, generated.expectedAnswer, difficulty)).toBe(true);
    }
  });

  it("rejects an obviously wrong answer", () => {
    const generated = generateChallenge(type, 2);
    expect(verifyChallengeAnswer(type, "definitely-wrong", generated.expectedAnswer, 2)).toBe(false);
  });
});

describe("proof_of_work", () => {
  it("accepts a correctly solved nonce and rejects an unsolved one", () => {
    const generated = generateChallenge("proof_of_work", 1);
    const { seed, bits } = JSON.parse(generated.expectedAnswer) as { seed: string; bits: number };
    expect(bits).toBeGreaterThan(0);

    // Brute force a valid nonce for the (small) test difficulty.
    let nonce = "";
    for (let i = 0; i < 2_000_000; i++) {
      const candidate = i.toString(16);
      const digest = createHash("sha256").update(`${seed}:${candidate}`).digest("hex");
      let leadingZeroBits = 0;
      for (const ch of digest) {
        const nibble = parseInt(ch, 16);
        if (nibble === 0) {
          leadingZeroBits += 4;
          continue;
        }
        leadingZeroBits += Math.clz32(nibble) - 28;
        break;
      }
      if (leadingZeroBits >= bits) {
        nonce = candidate;
        break;
      }
    }
    expect(nonce).not.toBe("");
    expect(verifyChallengeAnswer("proof_of_work", { nonce }, generated.expectedAnswer, 1)).toBe(true);
    expect(verifyChallengeAnswer("proof_of_work", { nonce: "0" }, generated.expectedAnswer, 1)).toBe(false);
  });
});

describe("cryptographic_proof", () => {
  it("accepts the precomputed digest and rejects a wrong one", () => {
    const generated = generateChallenge("cryptographic_proof", 1);
    const { expected } = JSON.parse(generated.expectedAnswer) as { expected: string };
    expect(verifyChallengeAnswer("cryptographic_proof", { digest: expected }, generated.expectedAnswer, 1)).toBe(true);
    expect(verifyChallengeAnswer("cryptographic_proof", { digest: "00".repeat(32) }, generated.expectedAnswer, 1)).toBe(
      false,
    );
  });
});

describe("selectChallengeType", () => {
  it("only selects accessible types when requireAccessible is set", () => {
    for (let i = 0; i < 50; i++) {
      const type = selectChallengeType({ requireAccessible: true });
      expect(ACCESSIBLE_CHALLENGE_TYPES).toContain(type);
    }
  });

  it("never selects computational types when disabled", () => {
    for (let i = 0; i < 50; i++) {
      const type = selectChallengeType({ allowComputational: false });
      expect(type).not.toBe("proof_of_work");
      expect(type).not.toBe("cryptographic_proof");
    }
  });
});
