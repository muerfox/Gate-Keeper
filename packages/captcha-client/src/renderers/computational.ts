import type { ChallengeRenderer } from "../types.js";
import { el } from "../dom.js";

/** Both computational challenge types run entirely in the background — no
 * user interaction, just a status indicator — using the browser's native
 * Web Crypto SHA-256 (never a hand-rolled hash implementation,
 * docs/THREAT_MODEL.md: "do not invent cryptography"). Work is chunked with
 * periodic `await` yields so a slower device's main thread stays
 * responsive rather than freezing for the whole computation
 * (docs/THREAT_MODEL.md: "never make this excessively expensive for
 * legitimate users"). */

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function countLeadingZeroBits(hex: string): number {
  let count = 0;
  for (const ch of hex) {
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

export const proofOfWorkRenderer: ChallengeRenderer = {
  async render(root, challenge) {
    const payload = challenge.payload as { seed: string; bits: number };
    const status = el("p", { class: "gk-status", role: "status" }, ["Verifying your browser…"]);
    root.append(el("div", { class: "gk-spinner", "aria-hidden": "true" }), status);

    let nonce = 0;
    for (;;) {
      const digest = await sha256Hex(`${payload.seed}:${nonce.toString(16)}`);
      if (countLeadingZeroBits(digest) >= payload.bits) {
        return { nonce: nonce.toString(16) };
      }
      nonce++;
      if (nonce % 500 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  },
};

export const cryptographicProofRenderer: ChallengeRenderer = {
  async render(root, challenge) {
    const payload = challenge.payload as { seed: string; iterations: number };
    const status = el("p", { class: "gk-status", role: "status" }, ["Verifying your browser…"]);
    root.append(el("div", { class: "gk-spinner", "aria-hidden": "true" }), status);

    let digestHex = payload.seed;
    let bytes = hexToBytes(digestHex);
    for (let i = 0; i < payload.iterations; i++) {
      const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
      bytes = new Uint8Array(digest);
      if (i % 1000 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    digestHex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return { digest: digestHex };
  },
};

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
