import { getServiceClient } from "@/lib/supabase/service";
import { signKioskSession } from "./session";

export type VerifyKioskPinResult = {
  ok: boolean;
  lockedUntil: string | null;
  attemptsRemaining: number;
  sessionToken?: string;
};

/** No next/headers import -- callable directly from the standalone tsx
 * verification script, outside a Next request context. The "use server"
 * action wraps this and handles the cookies() glue. */
export async function verifyKioskPinCore(storeId: string, pin: string): Promise<VerifyKioskPinResult> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("kiosk_verify_pin", { p_store_id: storeId, p_pin: pin });
  if (error) throw new Error(error.message);

  const row = (data ?? [])[0] as
    | { ok: boolean; locked_until: string | null; attempts_remaining: number }
    | undefined;
  if (!row) throw new Error("kiosk_verify_pin returned no rows");

  if (!row.ok) {
    return { ok: false, lockedUntil: row.locked_until, attemptsRemaining: row.attempts_remaining };
  }

  return {
    ok: true,
    lockedUntil: null,
    attemptsRemaining: row.attempts_remaining,
    sessionToken: signKioskSession(storeId),
  };
}
