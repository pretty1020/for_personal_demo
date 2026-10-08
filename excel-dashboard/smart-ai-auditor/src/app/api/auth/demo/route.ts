import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Server-only demo sign-in. Set DEMO_USER_EMAIL and DEMO_USER_PASSWORD in .env.local
 * and create the same user in Supabase Authentication (Dashboard → Users).
 */
export async function POST(request: Request) {
  const email = process.env.DEMO_USER_EMAIL?.trim();
  const password = process.env.DEMO_USER_PASSWORD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const reqUrl = new URL(request.url);
  const nextPath = reqUrl.searchParams.get("next") || "/app/dashboard";
  const redirectTo = new URL(nextPath, reqUrl.origin);

  const failRedirect = (msg: string) =>
    NextResponse.redirect(new URL(`/auth?demo_err=${encodeURIComponent(msg)}`, reqUrl.origin));

  if (!email || !password) {
    return failRedirect("Demo login not configured. Add DEMO_USER_EMAIL and DEMO_USER_PASSWORD.");
  }
  if (!url || !anon) {
    return failRedirect("Supabase URL or anon key missing.");
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return failRedirect(error.message);
  }

  return NextResponse.redirect(redirectTo);
}
