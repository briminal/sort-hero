import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Service-role client that bypasses RLS entirely. Only import this from
 * trusted server-only code that enforces its own authorization: public
 * anonymous-access Server Actions (buylist-portal, kiosk) where RLS has no
 * session to authorize against and strict Zod validation + explicit checks
 * are the security boundary instead, staff Server Actions that need to
 * touch service_role-only tables (e.g. *_credentials) after their own
 * owner/role check, webhook handlers, and cron/job endpoints. Never
 * reference this from a client-reachable path. */
export function getServiceClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
    if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
    client = createSupabaseClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}
