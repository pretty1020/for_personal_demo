import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";

export function formatFileStatus(status: string | null | undefined) {
  if (!status) return "—";
  if (status === "pending_review") return "Processing";
  return status.replaceAll("_", " ");
}

const fileMap: Record<string, NonNullable<ComponentProps<typeof Badge>["variant"]>> = {
  pending: "pending",
  validating: "validating",
  blocked: "blocked",
  approved: "approved",
  rejected: "rejected",
  processed: "processed",
  duplicate_blocked: "duplicate_blocked",
};

export function FileStatusBadge({ status }: { status: string }) {
  const variantKey = status === "pending_review" ? "validating" : status;
  const v = fileMap[variantKey] || "default";
  const label = formatFileStatus(status);
  return <Badge variant={v}>{label}</Badge>;
}

export function WorkflowStatusBadge({ status }: { status: string }) {
  const s = status || "disabled";
  return <Badge variant={s === "active" ? "active" : "disabled"}>{s}</Badge>;
}
