import { createHmac, timingSafeEqual } from "crypto";

// Kiosk sessions are a deliberately separate, lower-trust mechanism from
// Supabase Auth/SSR (see CLAUDE.md's Security Architecture section) -- a
// PIN unlocks browse-only access to exactly one store, nothing more, so
// this doesn't need full JWT infra, just a tamper-resistant signed payload.

export const KIOSK_SESSION_MAX_AGE_SECONDS = 60 * 60 * 18; // 18h: covers a full retail day without ever mid-browse kicking a customer back to the PIN screen, while still expiring overnight.

export function kioskCookieName(): string {
  return "sh_kiosk_session";
}

type KioskSessionPayload = { sid: string; iat: number; exp: number };

function getSecret(): string {
  const secret = process.env.KIOSK_SESSION_SECRET;
  if (!secret) throw new Error("KIOSK_SESSION_SECRET is not configured");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function signKioskSession(storeId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: KioskSessionPayload = { sid: storeId, iat: now, exp: now + KIOSK_SESSION_MAX_AGE_SECONDS };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyKioskSession(token: string | undefined | null, storeId: string): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [encodedPayload, signature] = parts as [string, string];

  const expectedSignature = sign(encodedPayload);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return false;
  }

  let payload: KioskSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return false;
  return payload.sid === storeId;
}
