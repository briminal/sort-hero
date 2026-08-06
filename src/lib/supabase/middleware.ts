import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
      // Same rationale as server.ts/client.ts: secure forced, httpOnly left
      // at the library default since the browser client reads this cookie
      // via document.cookie.
      cookieOptions: { sameSite: "lax", secure: process.env.NODE_ENV === "production" },
    },
  );

  // Refreshes the session if expired -- required for Server Components,
  // which cannot write cookies themselves.
  await supabase.auth.getUser();

  return response;
}
