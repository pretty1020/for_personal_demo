"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { FileStatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { NO_BACKEND, parseJsonSafe } from "@/lib/api-client";

type ReportRun = {
  id: string;
  passed: boolean;
  started_at: string;
  failure_reasons?: string | null;
  files?: {
    id?: string;
    original_name?: string;
    workflow_id?: string;
    status?: string;
    status_display?: string;
  };
};

type FileRow = {
  id: string;
  original_name: string;
  workflow_id: string | null;
  processed_at?: string | null;
  status?: string;
  status_display?: string;
  detail?: string | null;
};

type ReportsPayload = {
  runs: ReportRun[];
  processedFiles: FileRow[];
  failedFiles: FileRow[];
};

export default function ReportsPage() {
  const toast = useToast();
  const [payload, setPayload] = useState<ReportsPayload | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/reports");
      let json: ReportsPayload & { error?: string };
      try {
        json = await parseJsonSafe(res);
      } catch (e) {
        toast({ type: "error", message: e instanceof Error ? e.message : "Could not load reports" });
        return;
      }
      if (res.status === 503) {
        toast({ type: "info", message: NO_BACKEND });
        return;
      }
      if (!res.ok) {
        toast({ type: "error", message: json.error || "Could not load reports" });
        return;
      }
      setPayload({
        runs: json.runs || [],
        processedFiles: json.processedFiles || [],
        failedFiles: json.failedFiles || [],
      });
    })();
  }, [toast]);

  const runs = payload?.runs ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Validation results, processed files, and failures across all workflows."
      />

      <Card
        title="Processed files"
        subtitle="Files that passed validation and were processed successfully."
      >
        <div className="overflow-x-auto">
          <table className="data-table min-w-full text-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Processed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(payload?.processedFiles ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-slate-500">
                    No processed files yet.
                  </td>
                </tr>
              )}
              {(payload?.processedFiles ?? []).map((f) => (
                <tr key={f.id}>
                  <td className="font-medium text-slate-900">{f.original_name}</td>
                  <td className="text-slate-600">
                    {f.processed_at ? new Date(f.processed_at).toLocaleString() : "—"}
                  </td>
                  <td>
                    <Link className="text-link" href={`/files/${f.id}`}>
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Failed files" subtitle="Files blocked, rejected, or flagged as duplicates.">
        <div className="overflow-x-auto">
          <table className="data-table min-w-full text-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(payload?.failedFiles ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    No failed files.
                  </td>
                </tr>
              )}
              {(payload?.failedFiles ?? []).map((f) => (
                <tr key={f.id}>
                  <td className="font-medium text-slate-900">{f.original_name}</td>
                  <td>
                    <FileStatusBadge status={f.status || "blocked"} />
                  </td>
                  <td className="max-w-md text-xs text-slate-700">
                    {f.detail ? (
                      <span className="whitespace-pre-wrap break-words">{f.detail}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td>
                    <Link className="text-link" href={`/files/${f.id}`}>
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Validation history">
        <div className="overflow-x-auto">
          <table className="data-table min-w-full text-sm">
            <thead>
              <tr>
                <th>Started</th>
                <th>File</th>
                <th>Status</th>
                <th>Passed</th>
                <th>Reasons</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No validation runs yet.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="text-slate-600">{new Date(r.started_at).toLocaleString()}</td>
                  <td className="font-medium text-slate-900">{r.files?.original_name || "—"}</td>
                  <td className="capitalize text-slate-800">{r.files?.status_display || "—"}</td>
                  <td>{r.passed ? "Yes" : "No"}</td>
                  <td className="max-w-md text-xs text-slate-700">
                    {r.failure_reasons ? (
                      <span className="whitespace-pre-wrap break-words">{r.failure_reasons}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td>
                    {r.files?.id && (
                      <Link className="text-link" href={`/files/${r.files.id}`}>
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
