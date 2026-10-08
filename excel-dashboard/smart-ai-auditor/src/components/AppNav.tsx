"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/app/dashboard", label: "Dashboard" },
  { href: "/app/upload", label: "Upload" },
  { href: "/app/scanner", label: "Scanner" },
  { href: "/app/actions", label: "Actions" },
  { href: "/app/reports", label: "Reports" },
  { href: "/guide", label: "Guide" },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-2xl border border-white/10 bg-navy-900/60 p-1 text-sm shadow-lg backdrop-blur">
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-xl px-3 py-2 font-medium transition ${
              active
                ? "bg-gold-400/15 text-gold-200 ring-1 ring-gold-400/30"
                : "text-cream-200/80 hover:bg-white/5 hover:text-cream-50"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
