import {
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { UploadFrequency } from "@/lib/workflow-meta";

export type ScheduleStatus = "done" | "not_done" | "delayed";

export type PeriodWindow = {
  frequency: UploadFrequency;
  periodStart: Date;
  periodEnd: Date;
  label: string;
};

export function currentPeriodWindow(frequency: UploadFrequency, now = new Date()): PeriodWindow {
  if (frequency === "weekly") {
    const periodStart = startOfWeek(now, { weekStartsOn: 1 });
    const periodEnd = endOfWeek(now, { weekStartsOn: 1 });
    return {
      frequency,
      periodStart,
      periodEnd,
      label: `${format(periodStart, "MMM d")} – ${format(periodEnd, "MMM d, yyyy")}`,
    };
  }
  if (frequency === "monthly") {
    const periodStart = startOfMonth(now);
    const periodEnd = endOfMonth(now);
    return {
      frequency,
      periodStart,
      periodEnd,
      label: format(periodStart, "MMMM yyyy"),
    };
  }
  const periodStart = startOfDay(now);
  const periodEnd = endOfDay(now);
  return {
    frequency,
    periodStart,
    periodEnd,
    label: format(periodStart, "MMM d, yyyy"),
  };
}

function isPastDue(frequency: UploadFrequency, now: Date, period: PeriodWindow): boolean {
  if (now.getTime() > period.periodEnd.getTime()) return true;

  if (frequency === "daily") {
    // Same-day past due after 18:00 local if still missing.
    return now.getHours() >= 18;
  }
  if (frequency === "weekly") {
    // Friday after 18:00, or weekend, without upload → delayed.
    const day = now.getDay(); // 0=Sun … 5=Fri 6=Sat
    if (day === 0 || day === 6) return true;
    if (day === 5 && now.getHours() >= 18) return true;
    return false;
  }
  // Monthly: last 3 calendar days of the month without upload → delayed.
  return differenceInCalendarDays(period.periodEnd, now) <= 2;
}

export function evaluateScheduleStatus(input: {
  frequency: UploadFrequency;
  /** ISO timestamps of uploads/files that count toward completion */
  uploadTimestamps: string[];
  now?: Date;
}): {
  status: ScheduleStatus;
  period: PeriodWindow;
  lastUploadAt: string | null;
  doneAt: string | null;
} {
  const now = input.now ?? new Date();
  const period = currentPeriodWindow(input.frequency, now);
  const inPeriod = input.uploadTimestamps
    .map((iso) => ({ iso, t: new Date(iso).getTime() }))
    .filter(({ t }) => !Number.isNaN(t) && t >= period.periodStart.getTime() && t <= period.periodEnd.getTime())
    .sort((a, b) => b.t - a.t);

  const lastUploadAt =
    input.uploadTimestamps
      .map((iso) => ({ iso, t: new Date(iso).getTime() }))
      .filter(({ t }) => !Number.isNaN(t))
      .sort((a, b) => b.t - a.t)[0]?.iso ?? null;

  if (inPeriod.length) {
    return {
      status: "done",
      period,
      lastUploadAt,
      doneAt: inPeriod[0].iso,
    };
  }

  if (isPastDue(input.frequency, now, period)) {
    return { status: "delayed", period, lastUploadAt, doneAt: null };
  }
  return { status: "not_done", period, lastUploadAt, doneAt: null };
}

export function scheduleStatusLabel(status: ScheduleStatus): string {
  if (status === "done") return "Done";
  if (status === "delayed") return "Delayed";
  return "Not Done";
}
