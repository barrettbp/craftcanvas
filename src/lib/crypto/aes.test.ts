import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DecryptError, decrypt, deriveKey, encrypt } from "./aes";

describe("aes-256-gcm", () => {
  const original = process.env.CRAFT_KEY_ENCRYPTION_SECRET;

  beforeEach(() => {
    process.env.CRAFT_KEY_ENCRYPTION_SECRET = "unit-test-secret";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRAFT_KEY_ENCRYPTION_SECRET;
    else process.env.CRAFT_KEY_ENCRYPTION_SECRET = original;
  });

  it("derives a 32 byte key with SHA-256", () => {
    const key = deriveKey("abc");
    expect(key.length).toBe(32);
    expect(key.toString("hex")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("round trips a pdk_ key", () => {
    const plaintext = "pdk_0123456789abcdefghijklmnop";
    const { cipher, iv } = encrypt(plaintext);
    expect(Buffer.isBuffer(cipher)).toBe(true);
    expect(Buffer.isBuffer(iv)).toBe(true);
    expect(iv.length).toBe(12);
    // cipher text + 16 byte tag
    expect(cipher.length).toBe(Buffer.byteLength(plaintext) + 16);
    expect(cipher.toString("utf8")).not.toContain("pdk_");
    expect(decrypt({ cipher, iv })).toBe(plaintext);
  });

  it("uses a fresh IV each time", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.cipher.equals(b.cipher)).toBe(false);
  });

  it("handles empty and unicode plaintext", () => {
    expect(decrypt(encrypt(""))).toBe("");
    expect(decrypt(encrypt("héllo wörld 🚀"))).toBe("héllo wörld 🚀");
  });

  it("fails when the cipher text is tampered with", () => {
    const { cipher, iv } = encrypt("pdk_secret");
    const tampered = Buffer.from(cipher);
    tampered[0] ^= 0xff;
    expect(() => decrypt({ cipher: tampered, iv })).toThrow(DecryptError);
  });

  it("fails when the tag is tampered with", () => {
    const { cipher, iv } = encrypt("pdk_secret");
    const tampered = Buffer.from(cipher);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => decrypt({ cipher: tampered, iv })).toThrow(DecryptError);
  });

  it("fails with a different secret", () => {
    const { cipher, iv } = encrypt("pdk_secret");
    process.env.CRAFT_KEY_ENCRYPTION_SECRET = "another-secret";
    expect(() => decrypt({ cipher, iv })).toThrow(DecryptError);
  });

  it("accepts an explicit key", () => {
    const key = deriveKey("explicit");
    const enc = encrypt("value", key);
    expect(decrypt(enc, key)).toBe("value");
    expect(() => decrypt(enc)).toThrow(DecryptError);
  });

  it("rejects malformed input", () => {
    expect(() => decrypt({ cipher: Buffer.alloc(3), iv: Buffer.alloc(12) })).toThrow(DecryptError);
    expect(() => decrypt({ cipher: Buffer.alloc(20), iv: Buffer.alloc(5) })).toThrow(DecryptError);
  });

  it("reads the secret lazily", () => {
    delete process.env.CRAFT_KEY_ENCRYPTION_SECRET;
    expect(() => encrypt("x")).toThrow(/CRAFT_KEY_ENCRYPTION_SECRET/);
  });
});
