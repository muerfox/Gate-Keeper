import { randomInt, randomBytes } from "node:crypto";

/** All challenge randomness (which shapes appear, target angle, sequence
 * order, PoW seed, ...) must be cryptographically random. A predictable PRNG
 * here would let an attacker precompute answers (docs/THREAT_MODEL.md: "use
 * predictable randomness" is listed as a forbidden shortcut). */
export function secureRandomInt(minInclusive: number, maxExclusive: number): number {
  return randomInt(minInclusive, maxExclusive);
}

export function secureChoice<T>(items: readonly T[]): T {
  const item = items[secureRandomInt(0, items.length)];
  if (item === undefined) throw new Error("secureChoice called with empty array");
  return item;
}

export function secureShuffle<T>(items: readonly T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(0, i + 1);
    const ai = arr[i] as T;
    const aj = arr[j] as T;
    arr[i] = aj;
    arr[j] = ai;
  }
  return arr;
}

export function secureHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}
