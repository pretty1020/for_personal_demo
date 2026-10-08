import { usesJson } from "@/lib/db";
import { mariadbNotify, mariadbWriteAudit } from "@/lib/mariadb/repository";
import { standaloneAppendNotification, standaloneWriteAudit } from "@/lib/standalone/store";

export async function writeAudit(input: {
  action: string;
  fileId?: string | null;
  workflowId?: string | null;
  details?: Record<string, unknown>;
}) {
  if (usesJson()) {
    await standaloneWriteAudit(input);
    return;
  }
  await mariadbWriteAudit(input);
}

export async function notify(input: {
  type: string;
  title: string;
  message: string;
  fileId?: string | null;
  workflowId?: string | null;
}) {
  if (usesJson()) {
    await standaloneAppendNotification(input);
    return;
  }
  await mariadbNotify(input);
}
