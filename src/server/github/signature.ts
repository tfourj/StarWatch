import { createHmac, timingSafeEqual } from "node:crypto";

export function signPayload(secret: string, body: string | Uint8Array): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Verifies an X-Hub-Signature-256 header against the raw request body in constant time. */
export function verifySignature(secret: string, body: string | Uint8Array, header: string | null | undefined): boolean {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(signPayload(secret, body));
  const received = Buffer.from(header.trim());
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
