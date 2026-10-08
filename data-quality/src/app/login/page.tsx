"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MovateLogo } from "@/components/movate-logo";
import { Button } from "@/components/ui/button";
import { parseJsonSafe } from "@/lib/api-client";

import { PORTAL_URL } from "@/lib/portal-url";

export default function DqLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/dq-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await parseJsonSafe<{ error?: string; user?: { name: string } }>(res);
      if (!res.ok) {
        setError(json.error || "Sign-in failed.");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Sign-in failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--background)] via-[#f5f6f8] to-[var(--background-end)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center gap-3">
          <MovateLogo className="h-10 w-10 object-contain" />
          <div>
            <h1 className="text-lg font-semibold text-[var(--foreground)]">Data Quality sign in</h1>
          </div>
        </div>
        <p className="mb-6 text-sm text-[var(--muted)]">
          Sign in to access Dashboard, Upload, Workflows, Reports, Audit, and Settings.
        </p>
        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-accent-500/30 focus:ring-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-accent-500/30 focus:ring-2"
            />
          </label>
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <a
          href={PORTAL_URL}
          className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-slate-700 hover:bg-[var(--card-header)]"
        >
          <span aria-hidden="true">←</span>
          Main page
        </a>
      </div>
    </div>
  );
}
