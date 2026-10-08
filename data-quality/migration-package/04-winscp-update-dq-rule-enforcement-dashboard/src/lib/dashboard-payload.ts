import { differenceInMinutes, format, isValid, parseISO, subDays } from "date-fns";
import {
  getDataOwners,
  getRequireYyyymmdd,
  getUploadFrequencyExplicit,
  type UploadFrequency,
} from "@/lib/workflow-meta";
import { extractYyyymmddFromFileName } from "@/lib/filename-period";
import { evaluateScheduleStatus, scheduleStatusLabel, type ScheduleStatus } from "@/lib/workflow-schedule";

export type DashboardFileRow = {
  id: string;
  original_name: string;
  status: string;
  workflow_id: string | null;
  created_at: string;
  processed_at: string | null;
  intake_source?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type DashboardErrorRow = { code: string; severity: string };

export type DashboardRuleCheckRow = {
  itemKey: string;
  label: string;
  isCritical: boolean;
  workflowId: string | null;
  workflowName: string | null;
  clientName: string | null;
  fileId: string;
  fileName: string;
  passed: boolean;
  acknowledged: boolean;
  checkedAt: string;
};

export type DashboardWorkflowRow = {
  id: string;
  name: string;
  client_name?: string | null;
  status?: string;
  pass_rules?: Record<string, unknown>;
};

export type DashboardFilters = {
  client?: string | null;
  owner?: string | null;
  workflowId?: string | null;
};

function isPassedStatus(status: string) {
  return status === "processed" || status === "approved";
}

/** Uploads that count toward schedule "Done" for a period. */
function countsTowardSchedule(status: string) {
  return status !== "rejected" && status !== "duplicate_blocked";
}

function norm(s: string | null | undefined) {
  return (s || "").trim().toLowerCase();
}

export function workflowMatchesClient(
  wf: DashboardWorkflowRow,
  clientFilter: string | null | undefined,
): boolean {
  const q = norm(clientFilter);
  if (!q) return true;
  return norm(wf.client_name) === q;
}

export function workflowMatchesOwner(
  wf: DashboardWorkflowRow,
  ownerFilter: string | null | undefined,
): boolean {
  const q = norm(ownerFilter);
  if (!q) return true;
  return getDataOwners(wf.pass_rules).some((o) => norm(o) === q);
}

export function filterWorkflowsForDashboard(
  workflows: DashboardWorkflowRow[],
  filters: DashboardFilters,
): DashboardWorkflowRow[] {
  return workflows.filter((w) => {
    if (filters.workflowId && w.id !== filters.workflowId) return false;
    if (!workflowMatchesClient(w, filters.client)) return false;
    if (!workflowMatchesOwner(w, filters.owner)) return false;
    return true;
  });
}

export function buildFilterOptions(workflows: DashboardWorkflowRow[]) {
  const clients = new Set<string>();
  const owners = new Set<string>();
  for (const w of workflows) {
    if (w.client_name?.trim()) clients.add(w.client_name.trim());
    for (const o of getDataOwners(w.pass_rules)) owners.add(o);
  }
  return {
    clients: [...clients].sort((a, b) => a.localeCompare(b)),
    owners: [...owners].sort((a, b) => a.localeCompare(b)),
    workflows: [...workflows]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((w) => ({
        id: w.id,
        name: w.name,
        clientName: w.client_name?.trim() || null,
      })),
  };
}

export function buildDashboardPayload(input: {
  /** Files for charts/metrics/tables (date + status + scope filters applied). */
  files: DashboardFileRow[];
  /**
   * Files used only for schedule Done/Not Done/Delayed.
   * Must NOT be filtered by date/status — otherwise period status is wrong.
   */
  scheduleFiles?: DashboardFileRow[];
  duplicatePreventsFromAudit: number;
  errRows: DashboardErrorRow[];
  /** Latest checklist rule results for files in the metric set. */
  ruleCheckRows?: DashboardRuleCheckRow[];
  /** Workflows already scoped by client / owner / workflowId. */
  workflows: DashboardWorkflowRow[];
  /** Unscoped workflows used to populate filter dropdowns. */
  allWorkflows?: DashboardWorkflowRow[];
}) {
  const {
    files: list,
    scheduleFiles = list,
    duplicatePreventsFromAudit: dupAudit,
    errRows,
    ruleCheckRows = [],
    workflows: wfs,
    allWorkflows,
  } = input;

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
    passed: list.filter((f) => isPassedStatus(f.status)).length,
    failed: list.filter((f) => f.status === "blocked" || f.status === "rejected").length,
    completedToday: list.filter((f) => {
      if (!isPassedStatus(f.status) || !f.processed_at) return false;
      const d = parseISO(f.processed_at);
      return isValid(d) && d >= todayStart;
    }).length,
    duplicateAttempts: dupAudit + list.filter((f) => f.status === "duplicate_blocked").length,
  };

  const missingCols = (errRows || []).filter(
    (e) => e.code === "MISSING_COLUMNS" || e.code === "MISSING_VALUE",
  ).length;
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
    if (isPassedStatus(f.status)) trendMap[d].processed += 1;
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

  const wfById = new Map((wfs || []).map((w) => [w.id, w]));

  const wfStats: Record<string, { name: string; clientName: string | null; processed: number; failed: number }> =
    {};
  for (const f of list) {
    if (!f.workflow_id) continue;
    const wf = wfById.get(f.workflow_id);
    if (!wf) continue;
    wfStats[f.workflow_id] ||= {
      name: wf.name,
      clientName: wf.client_name?.trim() || null,
      processed: 0,
      failed: 0,
    };
    if (isPassedStatus(f.status)) wfStats[f.workflow_id].processed += 1;
    if (f.status === "blocked" || f.status === "rejected") wfStats[f.workflow_id].failed += 1;
  }
  const workflowPerformance = Object.entries(wfStats).map(([id, v]) => ({
    workflowId: id,
    name: v.name,
    clientName: v.clientName,
    processed: v.processed,
    failed: v.failed,
  }));

  const turnarounds: number[] = [];
  for (const f of list) {
    if (isPassedStatus(f.status) && f.processed_at) {
      const mins = safeMinutes(f.created_at, f.processed_at);
      if (mins !== null) turnarounds.push(mins);
    }
  }
  const avgTurnaround =
    turnarounds.length > 0 ? Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) : 0;

  const inFlight = new Set(["pending", "validating", "pending_review"]);
  const recent = list
    .filter((f) => !inFlight.has(f.status))
    .slice(0, 12)
    .map((f) => {
      const wf = f.workflow_id ? wfById.get(f.workflow_id) : undefined;
      return {
        ...f,
        workflow_name: wf?.name ?? null,
        client_name: wf?.client_name?.trim() || null,
      };
    });
  const failedFiles = list
    .filter((f) => f.status === "blocked" || f.status === "rejected" || f.status === "duplicate_blocked")
    .slice(0, 12)
    .map((f) => {
      const wf = f.workflow_id ? wfById.get(f.workflow_id) : undefined;
      return {
        ...f,
        workflow_name: wf?.name ?? null,
        client_name: wf?.client_name?.trim() || null,
      };
    });

  const scheduleReports = (wfs || [])
    .filter((w) => w.status === "active")
    .map((wf) => {
      const frequency = getUploadFrequencyExplicit(wf.pass_rules);
      if (!frequency) return null;

      const owners = getDataOwners(wf.pass_rules);
      const pattern =
        typeof wf.pass_rules?.file_name_pattern === "string" ? wf.pass_rules.file_name_pattern : null;
      const requirePeriod = getRequireYyyymmdd(wf.pass_rules);
      const wfFiles = scheduleFiles.filter(
        (f) => f.workflow_id === wf.id && countsTowardSchedule(f.status),
      );
      const filePeriodYyyymmdds = wfFiles
        .map((f) => {
          const metaPeriod =
            f.metadata && typeof f.metadata.period_yyyymmdd === "string"
              ? f.metadata.period_yyyymmdd
              : null;
          return metaPeriod || extractYyyymmddFromFileName(f.original_name);
        })
        .filter((t): t is string => Boolean(t));
      const evalResult = evaluateScheduleStatus({
        frequency,
        uploadTimestamps: wfFiles.map((f) => f.created_at),
        filePeriodYyyymmdds,
        requirePeriodToken: requirePeriod,
      });
      const latest = [...wfFiles].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      return {
        workflowId: wf.id,
        workflowName: wf.name,
        clientName: wf.client_name?.trim() || null,
        fileNamePattern: pattern,
        latestFileName: latest?.original_name || null,
        latestFileId: latest?.id || null,
        frequency,
        frequencyLabel: frequency.charAt(0).toUpperCase() + frequency.slice(1),
        owners,
        status: evalResult.status as ScheduleStatus,
        statusLabel: scheduleStatusLabel(evalResult.status),
        periodLabel: evalResult.period.label,
        lastUploadAt: evalResult.lastUploadAt,
        doneAt: evalResult.doneAt,
        periodMismatch: Boolean(evalResult.periodMismatch),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => {
      const order: Record<ScheduleStatus, number> = { delayed: 0, not_done: 1, done: 2 };
      return order[a.status] - order[b.status] || a.workflowName.localeCompare(b.workflowName);
    });

  const scheduleSummary = {
    done: scheduleReports.filter((r) => r.status === "done").length,
    notDone: scheduleReports.filter((r) => r.status === "not_done").length,
    delayed: scheduleReports.filter((r) => r.status === "delayed").length,
  };

  const alerts = scheduleReports
    .filter((r) => r.status === "delayed" || r.status === "not_done")
    .slice(0, 12)
    .map((r) => {
      const label = r.clientName || r.workflowName;
      return {
        severity: r.status === "delayed" ? ("danger" as const) : ("warning" as const),
        workflowId: r.workflowId,
        title: r.periodMismatch
          ? "Filename period mismatch"
          : r.status === "delayed"
            ? "Upload delayed"
            : "Upload not done",
        message: r.periodMismatch
          ? `${label}: filename YYYYMMDD does not match period ${r.periodLabel}`
          : r.status === "delayed"
            ? `${label}: no ${r.frequencyLabel.toLowerCase()} file for ${r.periodLabel}`
            : `${label}: awaiting ${r.frequencyLabel.toLowerCase()} upload (${r.periodLabel})`,
      };
    });

  const scheduleChart = [
    { name: "Done", value: scheduleSummary.done, fill: "#3d6b5a" },
    { name: "Not Done", value: scheduleSummary.notDone, fill: "#9a7209" },
    { name: "Delayed", value: scheduleSummary.delayed, fill: "#8b4545" },
  ];

  const ruleAgg: Record<
    string,
    { itemKey: string; label: string; isCritical: boolean; passed: number; failed: number }
  > = {};
  for (const row of ruleCheckRows) {
    const bucket = (ruleAgg[row.itemKey] ||= {
      itemKey: row.itemKey,
      label: row.label || row.itemKey,
      isCritical: row.isCritical,
      passed: 0,
      failed: 0,
    });
    if (row.passed) bucket.passed += 1;
    else bucket.failed += 1;
  }
  const rulePerformance = Object.values(ruleAgg)
    .map((r) => ({
      ...r,
      total: r.passed + r.failed,
      passRate: r.passed + r.failed ? Math.round((r.passed / (r.passed + r.failed)) * 100) : 0,
    }))
    .sort((a, b) => b.failed - a.failed || a.label.localeCompare(b.label));

  const ruleChart = rulePerformance.slice(0, 10).map((r) => ({
    name: r.label.length > 28 ? `${r.label.slice(0, 26)}…` : r.label,
    itemKey: r.itemKey,
    passed: r.passed,
    failed: r.failed,
    passRate: r.passRate,
  }));

  return {
    metrics: {
      ...metrics,
      missingColumnsIncidents: missingCols,
      invalidFormatIncidents: invalidFormat,
      scheduleDone: scheduleSummary.done,
      scheduleNotDone: scheduleSummary.notDone,
      scheduleDelayed: scheduleSummary.delayed,
      ruleChecksTotal: ruleCheckRows.length,
      ruleChecksFailed: ruleCheckRows.filter((r) => !r.passed).length,
    },
    trend,
    topFailures,
    workflowPerformance,
    rulePerformance,
    ruleChart,
    turnaround: { avgMinutes: avgTurnaround },
    tables: {
      recent,
      failedFiles,
      ruleChecks: ruleCheckRows.slice(0, 200),
    },
    scheduleReports,
    scheduleSummary,
    scheduleChart,
    alerts,
    filterOptions: buildFilterOptions(allWorkflows || wfs || []),
  };
}

export function emptyDashboardPayload() {
  return buildDashboardPayload({
    files: [],
    scheduleFiles: [],
    duplicatePreventsFromAudit: 0,
    errRows: [],
    workflows: [],
    allWorkflows: [],
  });
}

export type { UploadFrequency, ScheduleStatus };
