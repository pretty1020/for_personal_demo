"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <span className="inline-flex h-9 w-14 rounded-full border border-white/10 bg-white/5" />
    );
  }
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-medium text-cream-100 hover:bg-white/10"
      aria-label="Toggle dark mode"
    >
      <span className="text-gold-300">{dark ? "Dark" : "Light"}</span>
    </button>
  );
}
