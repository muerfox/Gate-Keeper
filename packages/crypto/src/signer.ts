import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { KeyMaterial } from "./keys.js";

export class TokenExpiredError extends Error {
  constructor() {
    super("token_expired");
  }
}

export class InvalidSignatureError extends Error {
  constructor(cause?: unknown) {
    super("invalid_signature");
    this.cause = cause;
  }
}

export interface SignOptions {
  /** JWT `sub` claim — used to distinguish challenge envelopes from
   * verification tokens so one can never be replayed as the other. */
  subject: string;
  expiresInSeconds: number;
  /** JWT `jti` — the single-use replay key. Callers must supply a
   * cryptographically random value (see random.ts); the signer does not
   * generate it, so that the same nonce used for replay-store bookkeeping
   * is provably the one covered by the signature. */
  jti: string;
}

/**
 * Thin, deliberately narrow wrapper around `jose`'s JWT sign/verify. This is
 * the ONLY place in Gate Keeper that touches signing algorithms directly —
 * every other package works with plain claims objects. No cryptographic
 * primitive is implemented here; this class only orchestrates calls into
 * `jose` (docs/THREAT_MODEL.md: "do not invent cryptography").
 */
export class JwsSigner {
  constructor(private readonly keys: KeyMaterial) {}

  async sign(claims: Record<string, unknown>, options: SignOptions): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: this.keys.alg })
      .setSubject(options.subject)
      .setJti(options.jti)
      .setIssuedAt(now)
      .setExpirationTime(now + options.expiresInSeconds)
      .setIssuer("gatekeeper")
      .sign(this.keys.signKey as never);
  }

  /** Verifies signature + expiry + expected subject. Throws
   * `InvalidSignatureError` or `TokenExpiredError` rather than returning a
   * boolean, so callers cannot accidentally ignore a failure — every caller
   * in apps/api must handle these explicitly. */
  async verify(token: string, expectedSubject: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.keys.verifyKey as never, {
        issuer: "gatekeeper",
        subject: expectedSubject,
        algorithms: [this.keys.alg],
      });
      return payload;
    } catch (err) {
      if (err instanceof Error && err.name === "JWTExpired") {
        throw new TokenExpiredError();
      }
      throw new InvalidSignatureError(err);
    }
  }
}
