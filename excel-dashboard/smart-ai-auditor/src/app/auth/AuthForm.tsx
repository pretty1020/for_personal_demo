"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const missing = params.get("missing") === "1";
  const demoErr = params.get("demo_err");
  const next = params.get("next") || "/app/dashboard";

  const configured = useMemo(
    () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    []
  );

  const demoEnabled = useMemo(
    () => process.env.NEXT_PUBLIC_DEMO_LOGIN_ENABLED === "true",
    []
  );
  const demoEmailHint = process.env.NEXT_PUBLIC_DEMO_EMAIL?.trim() || "";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!configured) {
      setError("Supabase environment variables are not available in the browser bundle.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-navy-950 to-navy-900 text-cream-100">
      <header className="mx-auto flex max-w-lg items-center justify-between px-4 py-6">
        <Link href="/" className="text-sm font-semibold text-gold-300 hover:underline">
          ← Home
        </Link>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-lg px-4 pb-16">
        <h1 className="font-display text-3xl text-cream-50">Owner access</h1>
        <p className="mt-2 text-sm text-cream-200/80">
          Email login powered by Supabase Auth. Create a simple password-protected owner account.
        </p>

        {demoErr && (
          <div className="mt-6 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-50">
            <p className="font-semibold">Demo sign-in failed</p>
            <p className="mt-2 text-red-50/90">{demoErr}</p>
          </div>
        )}

        {(missing || !configured) && (
          <div className="mt-6 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-50">
            <p className="font-semibold">Configuration needed</p>
            <p className="mt-2 text-amber-50/90">
              Add <code className="rounded bg-black/30 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code className="rounded bg-black/30 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
              <code className="rounded bg-black/30 px-1">.env.local</code> (local) or Render
              environment variables (production). Restart the dev server after saving.
            </p>
          </div>
        )}

        {demoEnabled && mode === "signin" && (
          <div className="mt-6 rounded-2xl border border-emerald-400/35 bg-emerald-500/10 p-4 text-sm text-emerald-50">
            <p className="font-semibold text-emerald-100">Demo account</p>
            <p className="mt-2 text-emerald-100/90">
              One-click sign-in uses server-side credentials. Create the same user in Supabase Auth
              (see README “Demo credentials”).
              {demoEmailHint ? (
                <>
                  {" "}
                  Expected email:{" "}
                  <code className="rounded bg-black/25 px-1 py-0.5">{demoEmailHint}</code>
                </>
              ) : null}
            </p>
            <form
              action={`/api/auth/demo?next=${encodeURIComponent(next)}`}
              method="post"
              className="mt-3"
            >
              <button
                type="submit"
                disabled={!configured}
                className="w-full rounded-full border border-emerald-400/50 bg-emerald-600/30 px-4 py-2.5 text-sm font-semibold text-emerald-50 hover:bg-emerald-600/45 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sign in as demo
              </button>
            </form>
          </div>
        )}

        <div className="mt-6 inline-flex rounded-full border border-white/10 bg-white/5 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded-full px-4 py-2 font-semibold ${
              mode === "signin" ? "bg-gold-400/20 text-gold-200" : "text-cream-200/70"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded-full px-4 py-2 font-semibold ${
              mode === "signup" ? "bg-gold-400/20 text-gold-200" : "text-cream-200/70"
            }`}
          >
            Create account
          </button>
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-8 space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-soft backdrop-blur"
        >
          {mode === "signup" && (
            <label className="block text-sm">
              <span className="text-cream-200/80">Display name</span>
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-navy-950/60 px-3 py-2 text-cream-50 outline-none ring-gold-400/40 focus:ring"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
          )}
          <label className="block text-sm">
            <span className="text-cream-200/80">Email</span>
            <input
              type="email"
              required
              className="mt-1 w-full rounded-xl border border-white/10 bg-navy-950/60 px-3 py-2 text-cream-50 outline-none ring-gold-400/40 focus:ring"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="block text-sm">
            <span className="text-cream-200/80">Password</span>
            <input
              type="password"
              required
              minLength={6}
              className="mt-1 w-full rounded-xl border border-white/10 bg-navy-950/60 px-3 py-2 text-cream-50 outline-none ring-gold-400/40 focus:ring"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </label>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={loading || !configured}
            className="w-full rounded-full bg-gold-400 py-3 text-sm font-semibold text-navy-950 hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-cream-200/60">
          By continuing you agree to use this tool with data you are allowed to process.
        </p>
      </main>
    </div>
  );
}
