import type { Redis } from "ioredis";
import type { ChallengeRecord } from "@gatekeeper/challenges";

const KEY_PREFIX = "gk:challenge:";

/** Atomically reads and deletes a challenge record in one round trip so
 * that "fetch the expected answer" and "mark the challenge as spent" are a
 * single indivisible operation — the same TOCTOU concern as token replay
 * (docs/ARCHITECTURE.md §Replay Protection). Two concurrent verify calls
 * for the same challenge id can never both see the record: exactly one
 * GET-then-DEL wins, and Lua/Redis command execution is single-threaded per
 * key, so there is no window between the two calls for another request to
 * interleave. */
const GET_AND_DELETE_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if v then
  redis.call('DEL', KEYS[1])
end
return v
`;

export class ChallengeStore {
  constructor(private readonly redis: Redis) {}

  async put(record: ChallengeRecord): Promise<void> {
    const ttlSeconds = Math.max(Math.ceil((record.expiresAt - Date.now()) / 1000), 1);
    await this.redis.set(KEY_PREFIX + record.id, JSON.stringify(record), "EX", ttlSeconds);
  }

  /** Returns the record on the FIRST call for a given challenge id, and
   * `null` on every subsequent call (or once expired) — this is what makes
   * a challenge single-use regardless of whether the answer submitted here
   * turns out to be correct. A wrong answer does not get a second attempt
   * against the same issued challenge; the client must request a new one
   * (this also bounds brute-force guessing against a single challenge
   * instance, e.g. repeatedly guessing a rotation angle). */
  async takeOnce(challengeId: string): Promise<ChallengeRecord | null> {
    const raw = (await this.redis.eval(GET_AND_DELETE_SCRIPT, 1, KEY_PREFIX + challengeId)) as string | null;
    if (!raw) return null;
    return JSON.parse(raw) as ChallengeRecord;
  }
}
