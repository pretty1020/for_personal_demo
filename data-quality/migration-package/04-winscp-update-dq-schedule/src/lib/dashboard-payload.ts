import { differenceInMinutes, format, isValid, parseISO, subDays } from "date-fns";
import {
  getDataOwners,
  getUploadFrequency,
  type UploadFrequency,
} from "@/lib/workflow-meta";
import { evaluateScheduleStatus, scheduleStatusLabel, type ScheduleStatus } from "@/lib/workflow-schedule";

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

export type DashboardWorkflowRow = {
  id: string;
  name: string;
  client_name?: string | null;
  status?: string;
  pass_rules?: Record<string, unknown>;
};

function isPassedStatus(status: string) {
  return status === "processed" || status === "approved";
}

/** Uploads that count toward schedule "Done" for a period. */
function countsTowardSchedule(status: string) {
  return status !== "rejected" && status !== "duplicate_blocked";
}

export function buildDashboardPayload(input: {
  files: DashboardFileRow[];
  duplicatePreventsFromAudit: number;
  errRows: DashboardErrorRow[];
  workflows: DashboardWorkflowRow[];
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
    passed: list.filter((f) => isPassedStatus(f.status)).length,
    failed: list.filter((f) => f.status === "blocked" || f.status === "rejected").length,
    completedToday: list.filter((f) => {
      if (!isPassedStatus(f.status) || !f.processed_at) return false;
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

  const wfStats: Record<string, { name?: string; clientName?: string | null; processed: number; failed: number }> = {};
  for (const f of list) {
    if (!f.workflow_id) continue;
    wfStats[f.workflow_id] ||= { processed: 0, failed: 0 };
    if (isPassedStatus(f.status)) wfStats[f.workflow_id].processed += 1;
    if (f.status === "blocked" || f.status === "rejected") wfStats[f.workflow_id].failed += 1;
  }
  const workflowPerformance = Object.entries(wfStats).map(([id, v]) => {
    const wf = wfs?.find((w) => w.id === id);
    return {
      workflowId: id,
      name: wf?.name || "Workflow",
      clientName: wf?.client_name || null,
      ...v,
    };
  });

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
      const wf = wfs?.find((w) => w.id === f.workflow_id);
      return {
        ...f,
        workflow_name: wf?.name || null,
        client_name: wf?.client_name || null,
      };
    });
  const failedFiles = list
    .filter((f) => f.status === "blocked" || f.status === "rejected" || f.status === "duplicate_blocked")
    .slice(0, 12)
    .map((f) => {
      const wf = wfs?.find((w) => w.id === f.workflow_id);
      return {
        ...f,
        workflow_name: wf?.name || null,
        client_name: wf?.client_name || null,
      };
    });

  const scheduleReports = (wfs || [])
    .filter((w) => !w.status || w.status === "active")
    .map((wf) => {
      const frequency = getUploadFrequency(wf.pass_rules);
      const owners = getDataOwners(wf.pass_rules);
      const pattern =
        typeof wf.pass_rules?.file_name_pattern === "string" ? wf.pass_rules.file_name_pattern : null;
      const wfFiles = list.filter((f) => f.workflow_id === wf.id && countsTowardSchedule(f.status));
      const evalResult = evaluateScheduleStatus({
        frequency,
        uploadTimestamps: wfFiles.map((f) => f.created_at),
      });
      const latest = wfFiles.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      return {
        workflowId: wf.id,
        workflowName: wf.name,
        clientName: wf.client_name || null,
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
      };
    })
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
    .map((r) => ({
      severity: r.status === "delayed" ? ("danger" as const) : ("warning" as const),
      workflowId: r.workflowId,
      title: r.status === "delayed" ? "Upload delayed" : "Upload not done",
      message:
        r.status === "delayed"
          ? `${r.clientName || r.workflowName}: no ${r.frequencyLabel.toLowerCase()} file for ${r.periodLabel}`
          : `${r.clientName || r.workflowName}: awaiting ${r.frequencyLabel.toLowerCase()} upload (${r.periodLabel})`,
    }));

  const scheduleChart = [
    { name: "Done", value: scheduleSummary.done, fill: "#3d6b5a" },
    { name: "Not Done", value: scheduleSummary.notDone, fill: "#9a7209" },
    { name: "Delayed", value: scheduleSummary.delayed, fill: "#8b4545" },
  ];

  return {
    metrics: {
      ...metrics,
      missingColumnsIncidents: missingCols,
      invalidFormatIncidents: invalidFormat,
      scheduleDone: scheduleSummary.done,
      scheduleNotDone: scheduleSummary.notDone,
      scheduleDelayed: scheduleSummary.delayed,
    },
    trend,
    topFailures,
    workflowPerformance,
    turnaround: { avgMinutes: avgTurnaround },
    tables: { recent, failedFiles },
    scheduleReports,
    scheduleSummary,
    scheduleChart,
    alerts,
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

export type { UploadFrequency, ScheduleStatus };
