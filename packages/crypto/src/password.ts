import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** Manually wrapped rather than `util.promisify(scrypt)` — the 5-argument
 * (with options) and 4-argument overloads of `crypto.scrypt` don't both
 * survive `promisify`'s overload inference in current @types/node, so we
 * call the options overload directly. */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** scrypt parameters (RFC 7914 recommended interactive-login values, scaled
 * up slightly). scrypt is a well-established, memory-hard KDF built into
 * Node's stdlib — chosen over a native argon2 binding so Gate Keeper has no
 * native-module build dependency, without resorting to a weak KDF. See
 * docs/THREAT_MODEL.md §4.13. */
const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Encoded as `scrypt$N$r$p$saltBase64url$hashBase64url` — a self-describing
 * format so parameters can be strengthened later without invalidating
 * existing hashes (verifyPassword reads the embedded params). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(saltB64 as string, "base64url");
  const expected = Buffer.from(hashB64 as string, "base64url");
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });

  // Constant-time comparison — never use === or Buffer.equals on secret
  // material (timing side channel), per docs/THREAT_MODEL.md.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
