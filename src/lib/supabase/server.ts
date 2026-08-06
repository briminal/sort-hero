import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component -- middleware handles session
            // refresh instead, so this is safe to ignore.
          }
        },
      },
      // secure is safe here (server-set cookies aren't read via
      // document.cookie); httpOnly is deliberately left at the library
      // default -- see client.ts, the browser client needs JS-readable
      // access to this same cookie name for session sync.
      cookieOptions: { sameSite: "lax", secure: process.env.NODE_ENV === "production" },
    },
  );
}
