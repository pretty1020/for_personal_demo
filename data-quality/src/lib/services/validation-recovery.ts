import { usesJson } from "@/lib/db";
import { mariadbGetFile, mariadbRecoverValidatingFiles, mariadbUpdateFile } from "@/lib/mariadb/repository";
import { writeStandalone } from "@/lib/standalone/store";

/** If validation throws after status was set to `validating`, unblock the file for operators. */
export async function recoverStuckValidatingFile(fileId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  try {
    if (usesJson()) {
      await writeStandalone((s) => {
        const f = s.files.find((x) => x.id === fileId);
        if (f?.status === "validating") {
          f.status = "blocked";
          f.updated_at = new Date().toISOString();
          f.metadata = {
            ...(typeof f.metadata === "object" && f.metadata ? f.metadata : {}),
            validation_job_error: message,
          };
        }
      });
      return;
    }

    const row = await mariadbGetFile(fileId);
    if (!row || row.status !== "validating") return;
    const meta =
      row.metadata && typeof row.metadata === "object" ? { ...(row.metadata as Record<string, unknown>) } : {};
    meta.validation_job_error = message;
    await mariadbUpdateFile(fileId, {
      status: "blocked",
      metadata: meta,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[validation-recovery]", e);
  }
}

export async function recoverAllStuckValidatingFiles() {
  if (usesJson()) {
    await writeStandalone((s) => {
      const now = new Date().toISOString();
      for (const f of s.files) {
        if (f.status === "validating") {
          f.status = "blocked";
          f.updated_at = now;
        }
      }
    });
    return;
  }
  await mariadbRecoverValidatingFiles();
}
