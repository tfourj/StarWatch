import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config";

const VERSION = "v1";

export interface Cipher {
  encrypt(plain: string): string;
  decrypt(payload: string): string;
  encryptJson(value: unknown): string;
  decryptJson<T>(payload: string): T;
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "starwatch", "aes-256-gcm-v1", 32));
}

/** AES-256-GCM with a random 96-bit IV. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function createCipher(secret: string): Cipher {
  const key = deriveKey(secret);

  const encrypt = (plain: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  };

  const decrypt = (payload: string) => {
    const [version, iv, tag, ciphertext] = payload.split(".");
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("invalid encrypted payload");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  };

  return {
    encrypt,
    decrypt,
    encryptJson: (value) => encrypt(JSON.stringify(value)),
    decryptJson: <T>(payload: string) => JSON.parse(decrypt(payload)) as T,
  };
}

let defaultCipher: Cipher | null = null;

export function cipher(): Cipher {
  if (!defaultCipher) defaultCipher = createCipher(getConfig().encryptionSecret);
  return defaultCipher;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Show only the last 4 characters of a secret. */
export function hint(secret: string): string {
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}
