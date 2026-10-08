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
import { yyyymmddToDate } from "@/lib/filename-period";

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
  /** Optional YYYYMMDD tokens extracted from filenames — preferred for period matching */
  filePeriodYyyymmdds?: string[];
  /** When true, Done requires a matching YYYYMMDD — never fall back to upload time alone */
  requirePeriodToken?: boolean;
  now?: Date;
}): {
  status: ScheduleStatus;
  period: PeriodWindow;
  lastUploadAt: string | null;
  doneAt: string | null;
  periodMismatch?: boolean;
} {
  const now = input.now ?? new Date();
  const period = currentPeriodWindow(input.frequency, now);

  const periodTokens = (input.filePeriodYyyymmdds || [])
    .map((t) => ({ token: t, date: yyyymmddToDate(t) }))
    .filter((x): x is { token: string; date: Date } => Boolean(x.date));

  const tokensInPeriod = periodTokens.filter(
    ({ date }) =>
      date.getTime() >= period.periodStart.getTime() && date.getTime() <= period.periodEnd.getTime(),
  );

  const uploadsInPeriod = input.uploadTimestamps
    .map((iso) => ({ iso, t: new Date(iso).getTime() }))
    .filter(({ t }) => !Number.isNaN(t) && t >= period.periodStart.getTime() && t <= period.periodEnd.getTime())
    .sort((a, b) => b.t - a.t);

  const lastUploadAt =
    input.uploadTimestamps
      .map((iso) => ({ iso, t: new Date(iso).getTime() }))
      .filter(({ t }) => !Number.isNaN(t))
      .sort((a, b) => b.t - a.t)[0]?.iso ?? null;

  // Prefer filename YYYYMMDD alignment with the schedule period.
  // When requirePeriodToken is true, do not fall back to upload timestamps.
  if (periodTokens.length || input.requirePeriodToken) {
    if (tokensInPeriod.length) {
      return {
        status: "done",
        period,
        lastUploadAt,
        doneAt: lastUploadAt,
        periodMismatch: false,
      };
    }
    // Files exist but none match this period's YYYYMMDD window — or none have tokens when required.
    if (isPastDue(input.frequency, now, period)) {
      return {
        status: "delayed",
        period,
        lastUploadAt,
        doneAt: null,
        periodMismatch: periodTokens.length > 0,
      };
    }
    return {
      status: "not_done",
      period,
      lastUploadAt,
      doneAt: null,
      periodMismatch: periodTokens.length > 0,
    };
  }

  if (uploadsInPeriod.length) {
    return {
      status: "done",
      period,
      lastUploadAt,
      doneAt: uploadsInPeriod[0].iso,
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
