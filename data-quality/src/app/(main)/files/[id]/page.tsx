"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { FileStatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { apiGet, NO_BACKEND } from "@/lib/api-client";
import { getSharePointUrl } from "@/lib/workflow-meta";
import { getFileVisibility } from "@/lib/file-visibility";

export default function FileDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const toast = useToast();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [markingSp, setMarkingSp] = useState(false);

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
  const wf = payload.workflow as {
    name?: string;
    client_name?: string | null;
    pass_rules?: Record<string, unknown>;
  } | null;
  const run = payload.validationRun as Record<string, unknown> | null;
  const errors = (payload.errors || []) as Array<Record<string, unknown>>;
  const checklist = (payload.checklist || []) as Array<Record<string, unknown>>;
  const defs = (payload.checklistDefs || []) as Array<{ item_key: string; label: string }>;
  const audit = (payload.audit || []) as Array<Record<string, unknown>>;
  const meta = (file.metadata || {}) as Record<string, unknown>;
  const preview = (meta.preview_rows as Record<string, string>[] | undefined) || [];
  const rejectionReason = meta.rejection_reason as string | undefined;
  const visibility = getFileVisibility(meta);
  const isPrivate = visibility === "private";
  const period = typeof meta.period_yyyymmdd === "string" ? meta.period_yyyymmdd : null;
  const sharepointUrl = getSharePointUrl(wf?.pass_rules || null);
  const sharepointUploadedAt =
    typeof meta.sharepoint_uploaded_at === "string" ? meta.sharepoint_uploaded_at : null;
  const passedStatus = file.status === "processed" || file.status === "approved";

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

  async function removeFile() {
    if (!confirm(`Delete uploaded file "${String(file.original_name)}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast({ type: "error", message: (json as { error?: string }).error || "Delete failed" });
        return;
      }
      toast({ type: "success", message: "File deleted" });
      router.push("/intake");
    } finally {
      setDeleting(false);
    }
  }

  async function setVisibility(next: "public" | "private") {
    const res = await fetch(`/api/files/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    if (!res.ok) toast({ type: "error", message: "Could not update visibility" });
    else {
      toast({ type: "success", message: `Marked ${next}` });
      void load();
    }
  }

  async function uploadToSharePoint() {
    if (!sharepointUrl) {
      toast({ type: "info", message: "Add a SharePoint link on the workflow first." });
      return;
    }
    setMarkingSp(true);
    try {
      window.open(sharepointUrl, "_blank", "noopener,noreferrer");
      const res = await fetch(`/api/files/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharepoint_uploaded: true }),
      });
      if (!res.ok) {
        toast({ type: "error", message: "Opened SharePoint, but could not mark upload" });
        return;
      }
      toast({ type: "success", message: "SharePoint opened — marked as uploaded" });
      void load();
    } finally {
      setMarkingSp(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={String(file.original_name)}
        description={`Workflow: ${wf?.name || String(file.workflow_id || "—")}${
          wf?.client_name ? ` · Client: ${wf.client_name}` : ""
        } · Source: ${String(file.intake_source)}${period ? ` · Period: ${period}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <FileStatusBadge status={String(file.status)} />
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                isPrivate
                  ? "bg-slate-100 text-slate-700 ring-slate-300"
                  : "bg-emerald-50 text-emerald-800 ring-emerald-200"
              }`}
            >
              {isPrivate ? "Private" : "Public"}
            </span>
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
        <Button type="button" variant="danger" disabled={deleting} onClick={() => void removeFile()}>
          {deleting ? "Deleting…" : "Delete file"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void rerun()}>
          Re-run validation
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void setVisibility(isPrivate ? "public" : "private")}
        >
          Make {isPrivate ? "Public" : "Private"}
        </Button>
        {passedStatus && sharepointUrl && (
          <Button type="button" disabled={markingSp} onClick={() => void uploadToSharePoint()}>
            {markingSp
              ? "Opening…"
              : sharepointUploadedAt
                ? "Re-open SharePoint"
                : "Upload to SharePoint"}
          </Button>
        )}
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
      {sharepointUploadedAt && (
        <p className="text-xs text-slate-500">
          SharePoint marked uploaded {new Date(sharepointUploadedAt).toLocaleString()}
          {sharepointUrl ? (
            <>
              {" · "}
              <a className="text-link" href={sharepointUrl} target="_blank" rel="noreferrer">
                Open folder
              </a>
            </>
          ) : null}
        </p>
      )}
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
            <dt className="text-slate-500">Visibility</dt>
            <dd>{isPrivate ? "Private" : "Public"}</dd>
            <dt className="text-slate-500">Period (YYYYMMDD)</dt>
            <dd className="font-mono">{period || "—"}</dd>
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
        {isPrivate ? (
          <p className="text-sm text-slate-600">
            This file is <strong>Private</strong>. Preview data is hidden on the report view.
            Switch to Public to show sample rows.
          </p>
        ) : preview.length === 0 ? (
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
            <li key={String(a.id)} className="flex justify-between gap-3 border-t border-slate-100 py-2 first:border-0">
              <span className="font-medium text-slate-800">{String(a.action)}</span>
              <span className="text-xs text-slate-500">{new Date(String(a.created_at)).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
