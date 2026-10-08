"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { FileStatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { apiGet, NO_BACKEND } from "@/lib/api-client";

export default function FileDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const toast = useToast();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await apiGet(`/api/files/${id}`);
    if (!res.ok) {
      setPayload(null);
      setLoadError(res.error);
      if (res.status === 503) toast({ type: "info", message: NO_BACKEND });
      setLoading(false);
      return;
    }
    setPayload(res.data);
    setLoading(false);
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (loadError) return <p className="text-sm text-rose-700">{loadError}</p>;
  if (!payload?.file) return <p className="text-sm text-slate-500">Not found.</p>;
  const file = payload.file as Record<string, unknown>;
  const wf = payload.workflow as { name?: string } | null;
  const run = payload.validationRun as Record<string, unknown> | null;
  const errors = (payload.errors || []) as Array<Record<string, unknown>>;
  const checklist = (payload.checklist || []) as Array<Record<string, unknown>>;
  const defs = (payload.checklistDefs || []) as Array<{ item_key: string; label: string }>;
  const audit = (payload.audit || []) as Array<Record<string, unknown>>;
  const preview = (file.metadata as { preview_rows?: Record<string, string>[] })?.preview_rows || [];
  const rejectionReason = (file.metadata as { rejection_reason?: string })?.rejection_reason;

  async function reject() {
    const reason = prompt("Reason (optional)") || "";
    const res = await fetch(`/api/files/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) toast({ type: "error", message: "Reject failed" });
    else toast({ type: "success", message: "Rejected" });
    void load();
  }

  async function rerun() {
    await fetch(`/api/files/${id}/validate`, { method: "POST" });
    toast({ type: "info", message: "Validation queued" });
    setTimeout(() => void load(), 800);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={String(file.original_name)}
        description={`Workflow: ${wf?.name || String(file.workflow_id || "—")} · Source: ${String(file.intake_source)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <FileStatusBadge status={String(file.status)} />
            <Link href={`/checklist/${id}`}>
              <Button variant="secondary" type="button">
                Checklist
              </Button>
            </Link>
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="danger" onClick={() => void reject()}>
          Reject (manual)
        </Button>
        <Button type="button" variant="secondary" onClick={() => void rerun()}>
          Re-run validation
        </Button>
        <a href={`/api/files/${id}/export-report?format=json`} target="_blank" rel="noreferrer">
          <Button variant="secondary" type="button">
            Download report (JSON)
          </Button>
        </a>
        <a href={`/api/files/${id}/export-report?format=csv`} target="_blank" rel="noreferrer">
          <Button variant="secondary" type="button">
            Download report (CSV)
          </Button>
        </a>
        <a href={`/api/files/${id}/export-failed-rows`} target="_blank" rel="noreferrer">
          <Button variant="ghost" type="button">
            Failed rows CSV
          </Button>
        </a>
        {file.status === "processed" && (
          <a href={`/api/files/${id}/download`} target="_blank" rel="noreferrer">
            <Button variant="ghost" type="button">
              Download processed copy
            </Button>
          </a>
        )}
      </div>
      {file.status === "rejected" && rejectionReason && (
        <Card title="Rejection note">
          <p className="text-sm text-rose-800">{rejectionReason}</p>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Metadata">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">ID</dt>
            <dd className="font-mono text-xs">{String(file.id)}</dd>
            <dt className="text-slate-500">Hash</dt>
            <dd className="break-all font-mono text-xs">{String(file.file_hash)}</dd>
            <dt className="text-slate-500">Size</dt>
            <dd>{String(file.size_bytes)} bytes</dd>
            <dt className="text-slate-500">MIME</dt>
            <dd>{String(file.mime_type || "—")}</dd>
          </dl>
        </Card>
        <Card title="Validation summary">
          {run ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Passed</dt>
                <dd className="font-medium">{run.passed ? "Yes" : "No"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Can proceed (critical)</dt>
                <dd className="font-medium">{run.can_proceed ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Summary</dt>
                <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-[var(--card-header)] p-2 text-xs ring-1 ring-[var(--border-subtle)]">
                  {JSON.stringify(run.summary, null, 2)}
                </pre>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No validation run yet.</p>
          )}
        </Card>
      </div>
      <Card title="Errors / warnings">
        <div className="max-h-64 overflow-auto text-sm">
          {errors.length === 0 && <p className="text-slate-500">No issues recorded.</p>}
          <ul className="space-y-2">
            {errors.map((e) => (
              <li key={String(e.id)} className="rounded-md border border-slate-100 px-2 py-1">
                <span className="font-medium text-slate-800">{String(e.code)}</span>{" "}
                <span className="text-slate-500">({String(e.severity)})</span> — {String(e.message)}
                {e.row_index != null && (
                  <span className="text-xs text-slate-500">
                    {" "}
                    · row {String(e.row_index)} {e.column_name ? `· ${String(e.column_name)}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Card>
      <Card title="Checklist snapshot">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Item</th>
              <th className="py-2">Passed</th>
              <th className="py-2">Acknowledged</th>
            </tr>
          </thead>
          <tbody>
            {defs.map((d) => {
              const row = checklist.find((c) => c.item_key === d.item_key);
              return (
                <tr key={d.item_key} className="border-t border-slate-100">
                  <td className="py-2">{d.label}</td>
                  <td className="py-2">{row?.passed ? "✓" : "—"}</td>
                  <td className="py-2">{row?.acknowledged ? "✓" : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card title="Data preview">
        {preview.length === 0 ? (
          <p className="text-sm text-slate-500">Preview available after validation completes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {Object.keys(preview[0]).map((h) => (
                    <th key={h} className="border-b border-slate-200 px-2 py-1 font-semibold text-slate-600">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, idx) => (
                  <tr key={idx}>
                    {Object.keys(preview[0]).map((h) => (
                      <td key={h} className="border-b border-slate-100 px-2 py-1">
                        {r[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Audit history">
        <ul className="space-y-2 text-sm">
          {audit.map((a) => (
            <li key={String(a.id)} className="flex justify-between gap-3 border-b border-slate-100 py-2">
              <span className="font-medium text-slate-800">{String(a.action)}</span>
              <span className="text-xs text-slate-500">{new Date(String(a.created_at)).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
