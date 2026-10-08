type ErrRow = { validation_run_id: string; code: string; message: string; severity: string };

type FileLite = { status?: string; metadata?: Record<string, unknown> } | null;

/** Summary for validation reports when a run or file outcome is blocked / failed. */
export function summarizeBlockingReasons(
  runId: string,
  runPassed: boolean,
  errors: ErrRow[],
  file: FileLite,
  checklistSummary?: string | null,
): string | null {
  const forRun = errors.filter((e) => e.validation_run_id === runId);
  const blocking = forRun.filter((e) => e.severity === "error");
  const list = blocking.length ? blocking : forRun;
  const parts = list.map((e) => `${e.code}: ${e.message}`);
  const meta = file?.metadata && typeof file.metadata === "object" ? file.metadata : {};
  const lastRun = meta.last_validation_run_id as string | undefined;
  const rejection = meta.rejection_reason as string | undefined;
  if (rejection && lastRun === runId && file?.status === "rejected" && parts.length === 0) {
    parts.push(rejection);
  }
  if (checklistSummary) parts.push(checklistSummary);
  if (parts.length) return parts.slice(0, 15).join(" · ");
  const blockedLike =
    !runPassed ||
    file?.status === "blocked" ||
    file?.status === "rejected" ||
    file?.status === "duplicate_blocked";
  if (blockedLike) return "No issue rows recorded for this run; open the file for detail.";
  return null;
}
