"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button, buttonLinkClass } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast";
import { NO_BACKEND, parseJsonSafe } from "@/lib/api-client";
import Link from "next/link";

type Wf = { id: string; name: string; client_name?: string | null; source_path?: string | null };
type Visibility = "public" | "private";
type ConflictAction = "overwrite" | "append";

export default function IntakePage() {
  const toast = useToast();
  const [workflows, setWorkflows] = useState<Wf[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [drag, setDrag] = useState(false);
  const [history, setHistory] = useState<{ id: string; name: string; at: string }[]>([]);
  const [folderScanSupported, setFolderScanSupported] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [conflict, setConflict] = useState<{ existingId: string; existingName: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadWf = useCallback(async () => {
    try {
      const [wfRes, cfgRes] = await Promise.all([
        fetch("/api/workflows"),
        fetch("/api/config").catch(() => null),
      ]);
      if (wfRes.status === 503) {
        toast({ type: "info", message: NO_BACKEND });
        return;
      }
      if (cfgRes?.ok) {
        const cfg = await parseJsonSafe<{ folderScanSupported?: boolean }>(cfgRes);
        setFolderScanSupported(cfg.folderScanSupported !== false);
      }
      if (!wfRes.ok) return;
      const json = await parseJsonSafe<{ workflows?: Wf[] }>(wfRes);
      const list = (json.workflows || []) as Wf[];
      setWorkflows(list);
      setWorkflowId((cur) => cur || list[0]?.id || "");
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "Failed to load workflows" });
    }
  }, [toast]);

  useEffect(() => {
    void loadWf();
  }, [loadWf]);

  const selected = workflows.find((w) => w.id === workflowId);

  async function uploadFile(file: File, conflictAction?: ConflictAction) {
    if (!workflowId) {
      toast({ type: "error", message: "Select a workflow" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("workflowId", workflowId);
      fd.set("file", file);
      fd.set("visibility", visibility);
      if (conflictAction) fd.set("conflictAction", conflictAction);

      const res = await fetch("/api/files/upload", { method: "POST", body: fd });
      let json: {
        error?: string;
        message?: string;
        file?: { id: string };
        duplicate?: boolean;
        filenameConflict?: boolean;
        existingId?: string;
        existingName?: string;
        conflictResolved?: string;
        periodYyyymmdd?: string;
      } = {};
      try {
        json = await parseJsonSafe(res);
      } catch (e) {
        toast({ type: "error", message: e instanceof Error ? e.message : "Upload failed" });
        return;
      }

      if (res.status === 409 && json.filenameConflict && json.existingId) {
        setPendingFile(file);
        setConflict({
          existingId: json.existingId,
          existingName: json.existingName || file.name,
        });
        return;
      }

      if (res.status === 409 && json.duplicate) {
        toast({ type: "info", message: "Duplicate content blocked for this workflow" });
        setPendingFile(null);
        setConflict(null);
        return;
      }

      if (!res.ok) {
        toast({ type: "error", message: json.error || "Upload failed" });
        return;
      }

      const actionNote = json.conflictResolved
        ? json.conflictResolved === "append"
          ? "merged"
          : "overwritten"
        : "uploaded";
      toast({
        type: "success",
        message: `${actionNote.charAt(0).toUpperCase() + actionNote.slice(1)} — validation queued${
          json.periodYyyymmdd ? ` · period ${json.periodYyyymmdd}` : ""
        }`,
      });
      setPendingFile(null);
      setConflict(null);
      if (json.file?.id) {
        setHistory((h) =>
          [{ id: json.file!.id, name: file.name, at: new Date().toISOString() }, ...h].slice(0, 20),
        );
      }
    } finally {
      setUploading(false);
    }
  }

  async function scan() {
    if (!workflowId) return;
    if (!folderScanSupported) {
      toast({ type: "info", message: "Folder scan is not available in this environment. Use Upload instead." });
      return;
    }
    setScanning(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/scan`, { method: "POST" });
      const json = await parseJsonSafe<{
        error?: string;
        ingested?: number;
        warning?: string;
        scanPath?: string;
        skipped?: { name: string; reason: string }[];
      }>(res);
      if (!res.ok) {
        toast({ type: "error", message: json.error || "Scan failed" });
        return;
      }
      if (json.warning) {
        toast({ type: "info", message: json.warning });
        return;
      }
      const skipped = json.skipped?.length ?? 0;
      toast({
        type: "success",
        message: `Scan complete — ${json.ingested ?? 0} new file(s)${skipped ? `, ${skipped} skipped` : ""}${
          json.scanPath ? ` (${json.scanPath})` : ""
        }`,
      });
    } catch (e) {
      toast({ type: "error", message: e instanceof Error ? e.message : "Scan failed" });
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Upload files"
        description="Submit CSV or Excel files for validation. Filenames must include YYYYMMDD for period tracking."
      />

      <Card title="Select workflow">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block text-sm font-medium text-slate-700">
            Workflow
            <select
              className="form-input mt-1 min-w-[200px]"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
            >
              <option value="">{workflows.length ? "Choose a workflow…" : "Loading…"}</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.client_name ? `${w.name} · ${w.client_name}` : w.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!workflowId || !folderScanSupported || scanning}
            onClick={() => void scan()}
            title={
              folderScanSupported
                ? selected?.source_path || "Scan workflow watch folder"
                : "Folder scan is not available here"
            }
          >
            {scanning ? "Scanning…" : "Scan folder"}
          </Button>
          {!folderScanSupported && (
            <p className="text-xs text-slate-500">Folder scan is disabled on this host; use Upload.</p>
          )}
        </div>
      </Card>

      <Card
        title="Upload"
        subtitle="Supported: CSV, XLSX, XLS. Filename must include a valid YYYYMMDD date and match the workflow pattern when set."
      >
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium text-slate-700">Visibility</span>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="visibility"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
            />
            Public (preview shown on reports)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="visibility"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
            />
            Private (preview hidden)
          </label>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void uploadFile(f);
          }}
          className={`flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-sm transition ${
            drag ? "border-brand-600 bg-brand-50/80 ring-2 ring-brand-600/10" : "border-[var(--border)] bg-[var(--card-header)]"
          }`}
        >
          <svg className="mb-3 h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <p className="font-medium text-slate-800">{uploading ? "Uploading…" : "Drop your file here"}</p>
          <p className="mt-1 text-slate-500">or click to browse · e.g. Client_Orders_20260324.csv</p>
          <label className="mt-4">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
                e.target.value = "";
              }}
            />
            <span className={buttonLinkClass("secondary", "cursor-pointer")}>Choose file</span>
          </label>
        </div>
      </Card>

      {conflict && pendingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200">
            <h3 className="text-lg font-semibold text-slate-900">Duplicate filename</h3>
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-medium text-slate-800">{pendingFile.name}</span> already exists
              {conflict.existingName !== pendingFile.name ? ` (as ${conflict.existingName})` : ""}.
              Choose how to continue:
            </p>
            <ul className="mt-3 space-y-1 text-sm text-slate-600">
              <li>
                <strong>Overwrite</strong> — replace the existing file contents
              </li>
              <li>
                <strong>Append / Merge</strong> — add new rows under the same headers
              </li>
            </ul>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={uploading}
                onClick={() => {
                  setConflict(null);
                  setPendingFile(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={uploading}
                onClick={() => void uploadFile(pendingFile, "append")}
              >
                Append / Merge
              </Button>
              <Button
                type="button"
                disabled={uploading}
                onClick={() => void uploadFile(pendingFile, "overwrite")}
              >
                Overwrite
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card title="Recent uploads">
        <ul className="divide-y divide-slate-100 text-sm">
          {history.length === 0 && <li className="py-4 text-slate-500">No uploads in this session yet.</li>}
          {history.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-3">
              <Link className="text-link truncate" href={`/files/${h.id}`}>
                {h.name}
              </Link>
              <span className="shrink-0 text-xs text-slate-500">{new Date(h.at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
