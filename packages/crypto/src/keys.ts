import { generateKeyPair, exportJWK, importJWK, type JWK, type KeyLike } from "jose";
import { randomBytes } from "node:crypto";

export type SigningAlgorithm = "EdDSA" | "HS256";

/** Resolved, ready-to-use key material for one signer. `signKey` must never
 * leave the issuing server process; `verifyKey` is safe to distribute
 * (asymmetric case) or must be treated as equally secret (HMAC case, where
 * sign and verify use the same secret — appropriate for self-hosted/offline
 * deployments where issuance and verification happen in the same trust
 * boundary; see docs/OFFLINE_MODE.md). */
export interface KeyMaterial {
  alg: SigningAlgorithm;
  signKey: KeyLike | Uint8Array;
  verifyKey: KeyLike | Uint8Array;
}

interface SerializedEdDSA {
  alg: "EdDSA";
  privateKeyJwk: JWK;
  publicKeyJwk: JWK;
}

interface SerializedHmac {
  alg: "HS256";
  secret: string; // base64url
}

type SerializedKeyMaterial = SerializedEdDSA | SerializedHmac;

/** Generates a new Ed25519 keypair suitable for online/hosted deployments
 * (asymmetric: the private signing key stays on the issuing service, the
 * public key can be safely distributed for local/offline verification if
 * ever needed). Returns an opaque string to place in an environment
 * variable / secret manager — never commit it to source control. */
export async function generateEd25519KeyMaterial(): Promise<string> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  const serialized: SerializedEdDSA = {
    alg: "EdDSA",
    privateKeyJwk: await exportJWK(privateKey),
    publicKeyJwk: await exportJWK(publicKey),
  };
  return Buffer.from(JSON.stringify(serialized)).toString("base64url");
}

/** Generates a new symmetric HMAC-SHA256 secret, appropriate for fully
 * self-hosted/offline deployments where one process both issues and
 * verifies challenges/tokens (docs/OFFLINE_MODE.md). Simpler operationally
 * than key-pair management, at the cost of not being able to separate an
 * "issuer" role from a "verifier" role. */
export function generateHmacKeyMaterial(): string {
  const secret = randomBytes(32).toString("base64url");
  const serialized: SerializedHmac = { alg: "HS256", secret };
  return Buffer.from(JSON.stringify(serialized)).toString("base64url");
}

/** Loads key material from the opaque string produced by the generators
 * above (typically read from an environment variable such as
 * GATEKEEPER_SIGNING_KEY). Throws if the value is missing or malformed —
 * Gate Keeper refuses to start with an absent/invalid signing key rather
 * than falling back to an insecure default. */
export async function loadSigningKeyMaterial(envValue: string | undefined): Promise<KeyMaterial> {
  if (!envValue) {
    throw new Error(
      "GATEKEEPER_SIGNING_KEY is not set. Generate one with the crypto package's " +
        "generateEd25519KeyMaterial()/generateHmacKeyMaterial() helpers — Gate Keeper will not " +
        "start with an implicit or default signing key.",
    );
  }

  let parsed: SerializedKeyMaterial;
  try {
    parsed = JSON.parse(Buffer.from(envValue, "base64url").toString("utf8"));
  } catch {
    throw new Error("GATEKEEPER_SIGNING_KEY is not valid — expected the base64url output of a key generator.");
  }

  if (parsed.alg === "EdDSA") {
    const privateKey = await importJWK(parsed.privateKeyJwk, "EdDSA");
    const publicKey = await importJWK(parsed.publicKeyJwk, "EdDSA");
    return { alg: "EdDSA", signKey: privateKey as KeyLike, verifyKey: publicKey as KeyLike };
  }

  if (parsed.alg === "HS256") {
    const secret = Buffer.from(parsed.secret, "base64url");
    if (secret.length < 32) {
      throw new Error("HMAC signing secret must be at least 256 bits.");
    }
    return { alg: "HS256", signKey: secret, verifyKey: secret };
  }

  throw new Error(`Unsupported signing algorithm in GATEKEEPER_SIGNING_KEY: ${(parsed as { alg?: string }).alg}`);
}
