import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SignOutButton } from "@/components/SignOutButton";

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream-50 text-navy-950 dark:bg-navy-950 dark:text-cream-100">
      <header className="border-b border-navy-900/10 bg-white/70 backdrop-blur dark:border-white/10 dark:bg-navy-900/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center justify-between gap-4 sm:justify-start">
            <Link href="/app/dashboard" className="flex items-center gap-3">
              <span className="h-9 w-9 rounded-2xl bg-gradient-to-br from-gold-300 to-gold-400 shadow-md shadow-gold-400/20" />
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-gold-600 dark:text-gold-300">
                  Smart AI Auditor
                </p>
                <p className="font-display text-base text-navy-950 dark:text-cream-50">Owner console</p>
              </div>
            </Link>
            <div className="flex items-center gap-2 sm:hidden">
              <ThemeToggle />
              <SignOutButton />
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <AppNav />
            <div className="hidden items-center gap-2 sm:flex">
              <ThemeToggle />
              <SignOutButton />
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
