"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast";
import { NO_BACKEND, parseJsonSafe } from "@/lib/api-client";

export default function AuditPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/audit");
      if (res.status === 503) {
        toast({ type: "info", message: NO_BACKEND });
        return;
      }
      try {
        const json = await parseJsonSafe<{ logs?: Record<string, unknown>[] }>(res);
        if (res.ok) setLogs(json.logs || []);
      } catch (e) {
        toast({ type: "error", message: e instanceof Error ? e.message : "Could not load audit log" });
      }
    })();
  }, [toast]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Complete record of uploads, validations, and processing decisions."
      />
      <Card title="Recent activity">
        <div className="overflow-x-auto">
          <table className="data-table min-w-full text-sm">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>File</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    No audit events yet.
                  </td>
                </tr>
              )}
              {logs.map((l) => (
                <tr key={String(l.id)}>
                  <td className="text-slate-600">{new Date(String(l.created_at)).toLocaleString()}</td>
                  <td className="font-medium text-slate-900">{String(l.action)}</td>
                  <td className="font-mono text-xs text-slate-600">
                    {l.file_id ? String(l.file_id).slice(0, 8) + "…" : "—"}
                  </td>
                  <td className="text-xs text-slate-600">
                    <pre className="max-w-md overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(l.details, null, 0)}
                    </pre>
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
