import { describe, expect, it } from "vitest";
import { decryptAtRest, encryptAtRest, generateEncryptionKey } from "./secretbox.js";

describe("encryptAtRest/decryptAtRest", () => {
  it("round-trips plaintext", () => {
    const key = generateEncryptionKey();
    const ciphertext = encryptAtRest("my totp seed", key);
    expect(decryptAtRest(ciphertext, key)).toBe("my totp seed");
  });

  it("fails to decrypt with the wrong key", () => {
    const key = generateEncryptionKey();
    const wrongKey = generateEncryptionKey();
    const ciphertext = encryptAtRest("secret", key);
    expect(() => decryptAtRest(ciphertext, wrongKey)).toThrow();
  });

  it("fails to decrypt tampered ciphertext (authentication tag mismatch)", () => {
    const key = generateEncryptionKey();
    const ciphertext = encryptAtRest("secret", key);
    const [iv, tag, data] = ciphertext.split(":");
    const tamperedData = Buffer.from(data!, "base64url");
    tamperedData[0] = (tamperedData[0]! ^ 0xff) as number;
    const tampered = `${iv}:${tag}:${tamperedData.toString("base64url")}`;
    expect(() => decryptAtRest(tampered, key)).toThrow();
  });
});
