import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";

/** Vercel Cron entrypoint. Deliberately thin, per CLAUDE.md: this only
 * kicks off the actual work in the Supabase Edge Function, it never does
 * the rate-limited sync work itself (that would risk exceeding a
 * serverless function's execution time limit). Auth'd via a shared cron
 * secret header, not a user session -- cron has no session. */
export async function POST(request: Request) {
  const cronSecret = request.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  const { data: dueConnections, error } = await supabase
    .from("marketplace_connections")
    .select("id, store_id, platform")
    .eq("status", "connected")
    .eq("auto_sync_enabled", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase env not configured" }, { status: 500 });
  }

  // Fire-and-forget invocation per connection -- the job endpoint's own job
  // is just to kick these off, not to wait for rate-limited external API
  // work to finish inline.
  const invocations = (dueConnections ?? []).map((connection) => {
    const functionName = connection.platform === "shopify" ? "sync-push-listings" : "sync-pull-tcgplayer-orders";
    return fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: connection.id, storeId: connection.store_id }),
    }).catch((err) => {
      console.error(`Failed to invoke ${functionName} for connection ${connection.id}`, err);
    });
  });

  await Promise.allSettled(invocations);

  return NextResponse.json({ triggered: (dueConnections ?? []).length });
}
