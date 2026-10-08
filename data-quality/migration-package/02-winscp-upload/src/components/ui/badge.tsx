import type { ReactNode } from "react";

const styles: Record<string, string> = {
  active: "bg-emerald-50/90 text-exec-success ring-exec-success/20",
  disabled: "bg-slate-100 text-slate-600 ring-slate-400/15",
  pending: "bg-amber-50/90 text-exec-warning ring-exec-warning/20",
  validating: "bg-brand-50 text-brand-700 ring-brand-600/15",
  blocked: "bg-rose-50/90 text-exec-danger ring-exec-danger/20",
  approved: "bg-emerald-50/90 text-exec-success ring-exec-success/20",
  rejected: "bg-rose-50/90 text-exec-danger ring-exec-danger/20",
  processed: "bg-teal-50/90 text-exec-success ring-exec-success/20",
  duplicate_blocked: "bg-orange-50/90 text-exec-warning ring-exec-warning/20",
  default: "bg-slate-100 text-slate-600 ring-slate-400/15",
};

export function Badge({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: keyof typeof styles;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${styles[variant] || styles.default}`}
    >
      {children}
    </span>
  );
}
