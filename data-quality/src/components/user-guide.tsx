"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import Link from "next/link";
import { userGuideSections } from "@/lib/user-guide-content";

type UserGuideButtonProps = {
  onClick: () => void;
  variant?: "sidebar" | "header";
  className?: string;
};

export function UserGuideButton({ onClick, variant = "sidebar", className = "" }: UserGuideButtonProps) {
  const base =
    variant === "sidebar"
      ? "flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
      : "inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--muted)] shadow-sm transition hover:border-brand-600/30 hover:text-brand-700";

  return (
    <button type="button" onClick={onClick} className={`${base} ${className}`.trim()}>
      <GuideIcon className="h-3.5 w-3.5 shrink-0" />
      User guide
    </button>
  );
}

type UserGuideModalProps = {
  open: boolean;
  onClose: () => void;
};

export function UserGuideModal({ open, onClose }: UserGuideModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[var(--foreground)]/40 backdrop-blur-sm"
        aria-label="Close user guide"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[min(85vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-elevated outline-none"
      >
        <div className="exec-card-header flex shrink-0 items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--foreground)]">
              User guide
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">How to use the Data Quality Tool</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-[var(--card-header)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            {userGuideSections.map((section) => (
              <section key={section.title}>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">{section.title}</h3>
                <ul className="mt-2 space-y-1.5">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-2 text-sm leading-relaxed text-[var(--muted)]">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent-500" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--card-header)] px-4 py-3 text-sm text-[var(--muted)]">
            <span className="font-medium text-[var(--foreground)]">Quick links: </span>
            <Link href="/intake" className="text-link" onClick={onClose}>
              Upload
            </Link>
            {" · "}
            <Link href="/workflows" className="text-link" onClick={onClose}>
              Workflows
            </Link>
            {" · "}
            <Link href="/reports" className="text-link" onClick={onClose}>
              Reports
            </Link>
          </div>
        </div>

        <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--card-header)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function GuideIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
