import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", encoded)).toBe(false);
  });

  it("never stores the password in plaintext", async () => {
    const password = "correct horse battery staple";
    const encoded = await hashPassword(password);
    expect(encoded).not.toContain(password);
  });

  it("produces different hashes for the same password (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
  });

  it("rejects malformed encoded hashes rather than throwing", async () => {
    expect(await verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });
});
