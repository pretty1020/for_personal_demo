import { differenceInMinutes, format, isValid, parseISO, subDays } from "date-fns";

export type DashboardFileRow = {
  id: string;
  original_name: string;
  status: string;
  workflow_id: string | null;
  created_at: string;
  processed_at: string | null;
  intake_source?: string | null;
};

export type DashboardErrorRow = { code: string; severity: string };

export function buildDashboardPayload(input: {
  files: DashboardFileRow[];
  duplicatePreventsFromAudit: number;
  errRows: DashboardErrorRow[];
  workflows: { id: string; name: string }[];
}) {
  const { files: list, duplicatePreventsFromAudit: dupAudit, errRows, workflows: wfs } = input;

  function safeDay(iso: string) {
    const d = parseISO(iso);
    return isValid(d) ? format(d, "yyyy-MM-dd") : null;
  }

  function safeMinutes(start: string, end: string) {
    const a = parseISO(start);
    const b = parseISO(end);
    if (!isValid(a) || !isValid(b)) return null;
    return differenceInMinutes(b, a);
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const metrics = {
    total: list.length,
    passed: list.filter((f) => f.status === "processed").length,
    failed: list.filter((f) => f.status === "blocked" || f.status === "rejected").length,
    completedToday: list.filter((f) => {
      if (f.status !== "processed" || !f.processed_at) return false;
      const d = parseISO(f.processed_at);
      return isValid(d) && d >= todayStart;
    }).length,
    duplicateAttempts: dupAudit + list.filter((f) => f.status === "duplicate_blocked").length,
  };

  const missingCols = (errRows || []).filter((e) => e.code === "MISSING_COLUMNS" || e.code === "MISSING_VALUE").length;
  const invalidFormat = (errRows || []).filter((e) =>
    ["PIVOT_LAYOUT", "READ_ERROR", "FILE_TYPE"].includes(e.code),
  ).length;

  const trendMap: Record<string, { processed: number; failed: number }> = {};
  for (let i = 13; i >= 0; i--) {
    const d = format(subDays(new Date(), i), "yyyy-MM-dd");
    trendMap[d] = { processed: 0, failed: 0 };
  }
  for (const f of list) {
    const d = safeDay(f.created_at);
    if (!d || !trendMap[d]) continue;
    if (f.status === "processed") trendMap[d].processed += 1;
    if (f.status === "blocked" || f.status === "rejected") trendMap[d].failed += 1;
  }
  const trend = Object.entries(trendMap).map(([date, v]) => ({ date, ...v }));

  const failCounts: Record<string, number> = {};
  for (const e of errRows || []) {
    failCounts[e.code] = (failCounts[e.code] || 0) + 1;
  }
  const topFailures = Object.entries(failCounts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const wfStats: Record<string, { name?: string; processed: number; failed: number }> = {};
  for (const f of list) {
    if (!f.workflow_id) continue;
    wfStats[f.workflow_id] ||= { processed: 0, failed: 0 };
    if (f.status === "processed") wfStats[f.workflow_id].processed += 1;
    if (f.status === "blocked" || f.status === "rejected") wfStats[f.workflow_id].failed += 1;
  }
  const workflowPerformance = Object.entries(wfStats).map(([id, v]) => ({
    workflowId: id,
    name: wfs?.find((w) => w.id === id)?.name || "Workflow",
    ...v,
  }));

  const turnarounds: number[] = [];
  for (const f of list) {
    if (f.status === "processed" && f.processed_at) {
      const mins = safeMinutes(f.created_at, f.processed_at);
      if (mins !== null) turnarounds.push(mins);
    }
  }
  const avgTurnaround =
    turnarounds.length > 0 ? Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) : 0;

  const inFlight = new Set(["pending", "validating", "pending_review"]);
  const recent = list
    .filter((f) => !inFlight.has(f.status))
    .slice(0, 12);
  const failedFiles = list
    .filter((f) => f.status === "blocked" || f.status === "rejected" || f.status === "duplicate_blocked")
    .slice(0, 12);

  return {
    metrics: {
      ...metrics,
      missingColumnsIncidents: missingCols,
      invalidFormatIncidents: invalidFormat,
    },
    trend,
    topFailures,
    workflowPerformance,
    turnaround: { avgMinutes: avgTurnaround },
    tables: { recent, failedFiles },
  };
}

export function emptyDashboardPayload() {
  return buildDashboardPayload({
    files: [],
    duplicatePreventsFromAudit: 0,
    errRows: [],
    workflows: [],
  });
}
