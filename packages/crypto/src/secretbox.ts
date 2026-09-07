import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM authenticated encryption for small at-rest secrets (e.g. an
 * administrator's TOTP seed). Established AEAD primitive via Node's stdlib
 * — no custom cryptography. Output format: base64url(iv):base64url(tag):base64url(ciphertext). */
export function encryptAtRest(plaintext: string, keyB64Url: string): string {
  const key = Buffer.from(keyB64Url, "base64url");
  if (key.length !== 32) throw new Error("encryption key must be 256 bits (32 bytes)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptAtRest(encoded: string, keyB64Url: string): string {
  const key = Buffer.from(keyB64Url, "base64url");
  const [ivB64, tagB64, dataB64] = encoded.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed ciphertext");
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64url");
}
