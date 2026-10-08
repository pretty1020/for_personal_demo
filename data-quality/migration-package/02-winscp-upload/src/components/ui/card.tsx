import type { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  children,
  actions,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="exec-card">
      {(title || subtitle || actions) && (
        <div className="exec-card-header flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}
