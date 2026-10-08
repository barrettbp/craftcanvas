/**
 * AES-256-GCM for Craft API keys at rest.
 *
 * - Key: SHA-256 of `CRAFT_KEY_ENCRYPTION_SECRET` (32 bytes), read lazily on
 *   every call so importing this module never touches the environment.
 * - IV: 12 random bytes per encryption.
 * - Output: `cipher` is the cipher text with the 16 byte GCM auth tag appended,
 *   `iv` is the nonce. Both are Buffers so they can be stored in `bytea` columns.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type EncryptedSecret = { cipher: Buffer; iv: Buffer };

/** Derives the 32 byte AES key from a secret string. Exported for tests. */
export function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function currentKey(): Buffer {
  return deriveKey(env.craftKeyEncryptionSecret());
}

/** Encrypts `plaintext` with the key derived from the configured secret. */
export function encrypt(plaintext: string, key: Buffer = currentKey()): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { cipher: Buffer.concat([body, tag]), iv };
}

export class DecryptError extends Error {
  constructor(message = "Could not decrypt value (wrong secret or corrupted data)") {
    super(message);
    this.name = "DecryptError";
  }
}

/** Decrypts a value produced by {@link encrypt}. Throws `DecryptError` on tampering or a wrong key. */
export function decrypt({ cipher, iv }: EncryptedSecret, key: Buffer = currentKey()): string {
  const cipherBuf = Buffer.isBuffer(cipher) ? cipher : Buffer.from(cipher);
  const ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(iv);
  if (cipherBuf.length < TAG_BYTES) throw new DecryptError("Cipher text too short");
  if (ivBuf.length !== IV_BYTES) throw new DecryptError("Unexpected IV length");

  const body = cipherBuf.subarray(0, cipherBuf.length - TAG_BYTES);
  const tag = cipherBuf.subarray(cipherBuf.length - TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, ivBuf);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptError();
  }
}
