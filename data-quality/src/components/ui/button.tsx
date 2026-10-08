import type { ButtonHTMLAttributes, ReactNode } from "react";

const baseClass =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50";

const variants: Record<string, string> = {
  primary:
    "bg-brand-800 text-white shadow-sm hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
  secondary:
    "bg-white text-slate-700 ring-1 ring-[var(--border)] hover:bg-[var(--card-header)] hover:text-[var(--foreground)]",
  danger: "bg-exec-danger text-white shadow-sm hover:bg-rose-800",
  ghost: "text-[var(--muted)] hover:bg-[var(--card-header)] hover:text-[var(--foreground)]",
};

export function buttonLinkClass(variant: keyof typeof variants = "primary", className = "") {
  return `${baseClass} ${variants[variant]} ${className}`.trim();
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: keyof typeof variants;
}) {
  return (
    <button className={buttonLinkClass(variant, className)} {...props}>
      {children}
    </button>
  );
}
