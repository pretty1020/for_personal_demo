"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { MovateLogo } from "@/components/movate-logo";
import { UserGuideButton, UserGuideModal } from "@/components/user-guide";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/intake", label: "Upload", icon: UploadIcon },
  { href: "/workflows", label: "Workflows", icon: WorkflowIcon },
  { href: "/reports", label: "Reports", icon: ReportIcon },
  { href: "/audit", label: "Audit", icon: AuditIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/capacity", label: "Capacity", icon: CapacityIcon },
];

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <MovateLogo className="h-9 w-9 shrink-0 object-contain" />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-400">Movate</p>
        <p className="text-[15px] font-semibold leading-tight tracking-tight text-white">Data Quality Tool</p>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [guideOpen, setGuideOpen] = useState(false);
  const isCapacity = pathname === "/capacity" || pathname.startsWith("/capacity/");

  return (
    <div className="flex min-h-screen">
      <UserGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
      {!isCapacity ? (
        <aside className="relative hidden w-60 shrink-0 bg-[var(--sidebar)] text-slate-300 md:flex md:flex-col">
          <div className="border-b border-white/[0.08] px-5 py-5">
            <BrandMark />
          </div>
          <nav className="flex-1 space-y-0.5 px-3 py-4">
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? "bg-[var(--sidebar-hover)] text-white ring-1 ring-accent-500/25"
                      : "text-slate-400 hover:bg-[var(--sidebar-hover)]/60 hover:text-slate-200"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? "text-accent-400" : "text-slate-500"}`} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="space-y-3 border-t border-white/[0.08] px-5 py-4">
            <UserGuideButton variant="sidebar" onClick={() => setGuideOpen(true)} />
            <p className="text-[11px] leading-relaxed text-slate-500">File validation &amp; processing</p>
          </div>
        </aside>
      ) : null}

      <div className="flex min-h-screen flex-1 flex-col">
        {!isCapacity ? (
          <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-white/95 backdrop-blur md:hidden">
            <div className="flex h-14 items-center justify-between gap-3 px-4">
              <div className="flex items-center gap-3">
                <MovateLogo className="h-8 w-8 shrink-0 object-contain" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-700">Movate</p>
                  <p className="text-sm font-semibold text-[var(--foreground)]">Data Quality Tool</p>
                </div>
              </div>
              <UserGuideButton variant="header" onClick={() => setGuideOpen(true)} />
            </div>
            <div className="flex gap-1 overflow-x-auto px-3 pb-3 scrollbar-thin">
              {nav.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                      active ? "bg-brand-800 text-white" : "bg-[var(--card-header)] text-[var(--muted)]"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </header>
        ) : null}

        <main
          className={`flex-1 ${
            isCapacity
              ? "min-h-screen bg-[var(--page,#faf5f8)] p-0"
              : "bg-gradient-to-br from-[var(--background)] via-[#f5f6f8] to-[var(--background-end)] p-5 md:p-8"
          }`}
        >
          <div className={isCapacity ? "w-full" : "mx-auto w-full max-w-7xl"}>
            {!isCapacity && (
              <div className="mb-4 hidden justify-end md:flex">
                <UserGuideButton variant="header" onClick={() => setGuideOpen(true)} />
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

type IconProps = { className?: string };

function DashboardIcon({ className }: IconProps) {
  return (
    <svg className={className} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
    </svg>
  );
}

function UploadIcon({ className }: IconProps) {
  return (
    <svg className={className} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  );
}

function WorkflowIcon({ className }: IconProps) {
  return (
    <svg className={className} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  );
}

function ReportIcon({ className }: IconProps) {
  return (
    <svg className={className} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function AuditIcon({ className }: IconProps) {
  return (
    <svg className={className} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CapacityIcon({ className }: IconProps) {
  return (
    <svg className={className} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
