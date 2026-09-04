import { describe, expect, it } from "vitest";
import { generateEd25519KeyMaterial, generateHmacKeyMaterial, loadSigningKeyMaterial } from "./keys.js";
import { InvalidSignatureError, JwsSigner, TokenExpiredError } from "./signer.js";
import { randomNonce } from "./random.js";

describe.each([
  ["Ed25519", generateEd25519KeyMaterial],
  ["HMAC", async () => generateHmacKeyMaterial()],
] as const)("JwsSigner (%s)", (_name, generate) => {
  it("round-trips a signed token", async () => {
    const keys = await loadSigningKeyMaterial(await generate());
    const signer = new JwsSigner(keys);
    const token = await signer.sign({ sid: "site1", act: "signup" }, { subject: "gk_token", jti: randomNonce(), expiresInSeconds: 60 });
    const payload = await signer.verify(token, "gk_token");
    expect(payload.sid).toBe("site1");
    expect(payload.act).toBe("signup");
  });

  it("rejects a token verified under the wrong subject (cross-type replay)", async () => {
    const keys = await loadSigningKeyMaterial(await generate());
    const signer = new JwsSigner(keys);
    const token = await signer.sign({}, { subject: "gk_challenge", jti: randomNonce(), expiresInSeconds: 60 });
    await expect(signer.verify(token, "gk_token")).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it("rejects a tampered payload", async () => {
    const keys = await loadSigningKeyMaterial(await generate());
    const signer = new JwsSigner(keys);
    const token = await signer.sign({ sid: "site1" }, { subject: "gk_token", jti: randomNonce(), expiresInSeconds: 60 });

    const [header, payload, sig] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
    decoded.sid = "site2"; // attacker attempts to change the site binding
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${sig}`;

    await expect(signer.verify(tampered, "gk_token")).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it("rejects an expired token", async () => {
    const keys = await loadSigningKeyMaterial(await generate());
    const signer = new JwsSigner(keys);
    const token = await signer.sign({}, { subject: "gk_token", jti: randomNonce(), expiresInSeconds: -1 });
    await expect(signer.verify(token, "gk_token")).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it("rejects a token signed by a different key (forgery attempt)", async () => {
    const keysA = await loadSigningKeyMaterial(await generate());
    const keysB = await loadSigningKeyMaterial(await generate());
    const signerA = new JwsSigner(keysA);
    const signerB = new JwsSigner(keysB);
    const token = await signerA.sign({}, { subject: "gk_token", jti: randomNonce(), expiresInSeconds: 60 });
    await expect(signerB.verify(token, "gk_token")).rejects.toBeInstanceOf(InvalidSignatureError);
  });
});

describe("loadSigningKeyMaterial", () => {
  it("throws when no key is configured (no insecure default)", async () => {
    await expect(loadSigningKeyMaterial(undefined)).rejects.toThrow();
  });

  it("throws on a malformed key", async () => {
    await expect(loadSigningKeyMaterial("not-valid-base64url-json")).rejects.toThrow();
  });
});
