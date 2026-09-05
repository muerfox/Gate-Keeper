import { describe, expect, it } from "vitest";
import { createOfflineGateKeeper } from "./engine.js";
import type { OfflineVerifyResult } from "./engine.js";

/** Brute-forces a `pattern_recognition`/`accessible_alternative` answer
 * without introspecting engine internals: each challenge is single-use, so
 * a wrong guess consumes it — the helper re-issues a fresh challenge before
 * each new candidate guess, always deriving the candidate list from the
 * CURRENT challenge (not a stale one from an earlier iteration). */
async function bruteForceSolve(
  gk: Awaited<ReturnType<typeof createOfflineGateKeeper>>,
  action: string,
  type: "pattern_recognition" | "accessible_alternative",
  maxAttempts = 20,
): Promise<{ result: OfflineVerifyResult; challengeId: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const challenge = await gk.issue(action, { type });
    const candidates =
      type === "pattern_recognition"
        ? (challenge.payload as { tiles: { id: string }[] }).tiles.map((t) => t.id)
        : (challenge.payload as { options: { id: string }[] }).options.map((o) => o.id);

    const result = await gk.verify({
      challengeId: challenge.id,
      action,
      signedEnvelope: challenge.signedEnvelope,
      answer: candidates[0],
    });
    if (result.success) return { result, challengeId: challenge.id };
  }
  throw new Error("brute force did not find the answer within maxAttempts");
}

describe("offline GateKeeper", () => {
  it("issues a challenge, verifies a correct answer, and mints a token", async () => {
    const gk = await createOfflineGateKeeper({ allowComputational: false });
    const { result } = await bruteForceSolve(gk, "signup", "pattern_recognition");

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("SUCCESS");
    expect(result.token).toBeTruthy();
  });

  it("rejects a second verify attempt against the same challenge", async () => {
    const gk = await createOfflineGateKeeper();
    const challenge = await gk.issue("signup", { type: "accessible_alternative" });

    const first = await gk.verify({ challengeId: challenge.id, action: "signup", signedEnvelope: challenge.signedEnvelope, answer: "wrong" });
    expect(first.outcome).toBe("FAILED_ANSWER");

    const second = await gk.verify({ challengeId: challenge.id, action: "signup", signedEnvelope: challenge.signedEnvelope, answer: "wrong" });
    expect(second.outcome).toBe("ALREADY_CONSUMED");
  });

  it("consumes a minted token exactly once via verifyToken, and rejects reuse", async () => {
    const gk = await createOfflineGateKeeper({ siteId: "kiosk-1" });
    const { result } = await bruteForceSolve(gk, "login", "accessible_alternative");
    expect(result.token).toBeTruthy();

    const first = await gk.verifyToken(result.token!, "login");
    expect(first.success).toBe(true);

    const second = await gk.verifyToken(result.token!, "login");
    expect(second.success).toBe(false);
    expect(second.outcome).toBe("ALREADY_CONSUMED");
  });

  it("rejects a token verified under the wrong action", async () => {
    const gk = await createOfflineGateKeeper();
    const { result } = await bruteForceSolve(gk, "login", "accessible_alternative");

    const res = await gk.verifyToken(result.token!, "checkout");
    expect(res.success).toBe(false);
    expect(res.outcome).toBe("ACTION_MISMATCH");
  });

  it("rejects a challenge answered under the wrong action binding", async () => {
    const gk = await createOfflineGateKeeper();
    const challenge = await gk.issue("signup", { type: "accessible_alternative" });

    const res = await gk.verify({ challengeId: challenge.id, action: "checkout", signedEnvelope: challenge.signedEnvelope, answer: "anything" });
    expect(res.success).toBe(false);
  });

  it("two independently created instances (different signing keys) cannot verify each other's tokens", async () => {
    const gkA = await createOfflineGateKeeper();
    const gkB = await createOfflineGateKeeper();
    const { result } = await bruteForceSolve(gkA, "login", "accessible_alternative");

    const res = await gkB.verifyToken(result.token!, "login");
    expect(res.success).toBe(false);
  });
});
