import { createBrowserClient } from "@supabase/ssr";

// httpOnly is deliberately NOT set here: this client has no custom `cookies`
// handler, so @supabase/ssr falls back to reading/writing the session cookie
// via document.cookie in the browser -- an httpOnly cookie is invisible to
// that API, which would silently break client-side session sync (signIn,
// onAuthStateChange, etc.) across every interactive feature (POS, kiosk).
// `secure` is safe to force, though, since it only affects transport.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { sameSite: "lax", secure: process.env.NODE_ENV === "production" } },
  );
}
