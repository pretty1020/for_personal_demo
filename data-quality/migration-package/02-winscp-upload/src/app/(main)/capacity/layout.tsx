import type { ReactNode } from "react";

/** Capacity embed uses its own stylesheet; main app shell wraps this section. */
export default function CapacityLayout({ children }: { children: ReactNode }) {
  return <div className="capacity-layout w-full">{children}</div>;
}
